import BN from "bn.js";
import BigNumber from "bignumber.js";
import invariant from "tiny-invariant";
import { Transaction, TransactionResult } from "@mysten/sui/transactions";
import {
  AggregatorQuoter,
  TradeBuilder,
  GetRoutesResult,
  Commission,
  CommissionType,
} from "@flowx-finance/sdk";
import {
  BPS,
  Percent,
  Coin,
  ZERO,
} from "./utils/sdkTypes";

import {
  AggregatorPriceProvider,
  Pool,
  Position,
  createPositionManager,
} from "./entities";
import { jsonRpcProvider } from "./utils/jsonRpcProvider";
import { ZapCalculator } from "./utils/zapCalculator";
import { PriceProvider } from "./entities";
import { convertAmountToDecimalAmount, getToken } from "./utils/tokenHelper";
import { refundTokensIfNecessary } from "./utils/tokenHelper";

const ZERO_COMMISSION = 0;

interface RebalancerConstructorArgs {
  slippageTolerance: Percent;
  priceImpactPercentThreshold?: Percent;
  minZapAmounts: { amountX: BN; amountY: BN };
  priceProvider?: PriceProvider;
  rewardThresholdUsd?: BN;
  trackingVolumeAddress?: string;
}

export class PositionManager {
  private slippageTolerance: Percent;
  private priceImpactPercentThreshold?: Percent;
  private minZapAmounts: { amountX: BN; amountY: BN };
  private quoter: AggregatorQuoter;
  private priceProvider: PriceProvider;
  private rewardThresholdUsd?: BN;
  private trackingVolumeAddress?: string;

  constructor({
    slippageTolerance,
    priceImpactPercentThreshold,
    minZapAmounts,
    priceProvider,
    rewardThresholdUsd,
    trackingVolumeAddress,
  }: RebalancerConstructorArgs) {
    this.slippageTolerance = slippageTolerance;
    this.priceImpactPercentThreshold = priceImpactPercentThreshold;
    this.minZapAmounts = minZapAmounts;
    this.rewardThresholdUsd = rewardThresholdUsd;
    this.trackingVolumeAddress = trackingVolumeAddress;
    invariant(
      this.slippageTolerance.numerator.gte(ZERO) &&
        this.slippageTolerance.numerator.lte(BPS),
      "slippageTolerance must be between 0 and 1"
    );

    this.quoter = new AggregatorQuoter("mainnet");
    this.priceProvider = priceProvider ?? new AggregatorPriceProvider();
  }

  private async checkPriceImpact(quote: GetRoutesResult<Coin, Coin>) {
    const [tokenIn, tokenOut] = await Promise.all([
      getToken(quote.coinIn.coinType),
      getToken(quote.coinOut.coinType),
    ]);

    const [tokenInPriceUSD, tokenOutPriceUSD] = await Promise.all([
      this.priceProvider.getPrice(quote.coinIn.coinType),
      this.priceProvider.getPrice(quote.coinOut.coinType),
    ]);

    const amountInUSD = new BigNumber(
      convertAmountToDecimalAmount(quote.amountIn, tokenIn.decimals)
    ).multipliedBy(tokenInPriceUSD);
    const amountOutUSD = new BigNumber(
      convertAmountToDecimalAmount(quote.amountOut, tokenOut.decimals)
    ).multipliedBy(tokenOutPriceUSD);

    const priceImpact = new Percent(
      amountOutUSD
        .multipliedBy(BPS.toString())
        .minus(amountInUSD.multipliedBy(BPS.toString()))
        .toFixed(0),
      amountOutUSD.multipliedBy(BPS.toString()).toFixed(0)
    );

    invariant(
      !this.priceImpactPercentThreshold ||
        priceImpact.gt(this.priceImpactPercentThreshold),
      "exceeded price impact threshold"
    );
  }

  private async doesRewardExceedValueThreshold(
    coinType: string,
    amount: BN
  ): Promise<boolean> {
    if (!this.rewardThresholdUsd) return true;

    const token = await getToken(coinType);
    const priceUSD = await this.priceProvider.getPrice(coinType);
    const amountUSD = new BigNumber(
      convertAmountToDecimalAmount(amount, token.decimals)
    ).multipliedBy(priceUSD);

    return amountUSD.gte(this.rewardThresholdUsd.toString());
  }

  swapPositionRewardToPoolToken =
    (
      position: Position,
      targetCoin: { coin: Coin; object: TransactionResult },
      rewardCoin: { coin: Coin; object: TransactionResult },
      amount: BN
    ) =>
    async (tx: Transaction) => {
      const quote = await this.quoter.getRoutes({
        tokenIn: rewardCoin.coin.coinType,
        tokenOut: targetCoin.coin.coinType,
        amountIn: amount.toString(),
        excludePools: [position.pool.id],
      });
      await this.checkPriceImpact(quote);

      const tradeBuilder = new TradeBuilder("mainnet", quote.routes).slippage(
        this.slippageTolerance.numerator.toNumber()
      );
      if (!!this.trackingVolumeAddress) {
        tradeBuilder.commission(
          new Commission(
            this.trackingVolumeAddress,
            rewardCoin.coin,
            CommissionType.PERCENTAGE,
            ZERO_COMMISSION
          )
        );
      }
      const trade = tradeBuilder.build();
      const swapped = (await trade.swap({
        tx,
        coinIn: rewardCoin.object,
        client: jsonRpcProvider,
      })) as TransactionResult;
      tx.mergeCoins(targetCoin.object, [swapped]);

      return new BN(quote.amountOut);
    };

  zap =
    (
      position: Position,
      sourceCoin: { coin: Coin; object: TransactionResult },
      targetCoin: { coin: Coin; object: TransactionResult },
      amount: BN
    ) =>
    async (tx: Transaction) => {
      const zapAmount = await ZapCalculator.zapAmount({
        pool: position.pool as Pool,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        amount: amount,
        isCoinX: sourceCoin.coin.equals(position.pool.coinX),
        priceProvider: this.priceProvider,
      });
      invariant(zapAmount.gt(ZERO), "invalid zap amount");

      const quote = await this.quoter.getRoutes({
        tokenIn: sourceCoin.coin.coinType,
        tokenOut: targetCoin.coin.coinType,
        amountIn: zapAmount.toString(),
        excludePools: [position.pool.id],
      });
      await this.checkPriceImpact(quote);

      const tradeBuilder = new TradeBuilder("mainnet", quote.routes).slippage(
        this.slippageTolerance.numerator.toNumber()
      );
      if (!!this.trackingVolumeAddress) {
        tradeBuilder.commission(
          new Commission(
            this.trackingVolumeAddress,
            targetCoin.coin,
            CommissionType.PERCENTAGE,
            ZERO_COMMISSION
          )
        );
      }
      const trade = tradeBuilder.build();
      const [zapCoin] = tx.splitCoins(sourceCoin.object, [
        zapAmount.toString(),
      ]);
      const swapped = (await trade.swap({
        tx,
        coinIn: zapCoin,
        client: jsonRpcProvider,
      })) as TransactionResult;
      tx.mergeCoins(targetCoin.object, [swapped]);

      return {
        zapAmount,
        amountOut: new BN(quote.amountOut),
      };
    };

  migrate =
    (position: Position, tickLower: number, tickUpper: number) =>
    async (tx: Transaction) => {
      const positionManager = createPositionManager(
        (position.pool as Pool).protocol
      );
      const [coinX, coinY] = [position.pool.coinX, position.pool.coinY];
      const [feeAmounts, rewardAmounts] = await Promise.all([
        position.getFees(),
        position.getRewards(),
      ]);

      const [removedX, removedY] = positionManager.decreaseLiquidity(position, {
        slippageTolerance: this.slippageTolerance,
        deadline: Number.MAX_SAFE_INTEGER,
      })(tx);

      const poolTokenRewards = {
        amountX: new BN(0),
        amountY: new BN(0),
      };
      const nonPoolTokenRewards: {
        coin: Coin;
        object: TransactionResult;
        amount: BN;
      }[] = [];
      position.pool.poolRewards.forEach(async (rewardInfo, idx) => {
        if (rewardAmounts[idx].gt(new BN(0))) {
          const collectedReward = positionManager.collectReward(position, {
            rewardCoin: rewardInfo.coin,
          })(tx);

          if (rewardInfo.coin.equals(coinX)) {
            poolTokenRewards.amountX = poolTokenRewards.amountX.add(
              rewardAmounts[idx]
            );
            tx.mergeCoins(removedX, [collectedReward]);
          } else if (rewardInfo.coin.equals(coinY)) {
            poolTokenRewards.amountY = poolTokenRewards.amountY.add(
              rewardAmounts[idx]
            );
            tx.mergeCoins(removedY, [collectedReward]);
          } else {
            nonPoolTokenRewards.push({
              coin: rewardInfo.coin,
              object: collectedReward,
              amount: rewardAmounts[idx],
            });
          }
        }
      });

      const burnAmounts = {
        amountX: position.mintAmounts.amountX.add(feeAmounts.amountX),
        amountY: position.mintAmounts.amountY.add(feeAmounts.amountY),
      };
      const expectedMintAmounts = {
        amountX: burnAmounts.amountX.add(poolTokenRewards.amountX),
        amountY: burnAmounts.amountY.add(poolTokenRewards.amountY),
      };

      positionManager.closePosition(position)(tx);

      let positionThatWillBeCreated = Position.fromAmounts({
        owner: position.owner,
        pool: position.pool,
        tickLower,
        tickUpper,
        amountX: expectedMintAmounts.amountX,
        amountY: expectedMintAmounts.amountY,
        useFullPrecision: true,
      });

      let remainingX = expectedMintAmounts.amountX.sub(
        positionThatWillBeCreated.mintAmounts.amountX
      );
      let remainingY = expectedMintAmounts.amountY.sub(
        positionThatWillBeCreated.mintAmounts.amountY
      );

      //Only one of the two assets, X or Y, is redundant when liquidity is added.
      if (remainingX.gt(this.minZapAmounts.amountX)) {
        const totalConvertedAmount = (
          await Promise.all(
            nonPoolTokenRewards.map(async (reward) => {
              const rewardExceededThreshold =
                await this.doesRewardExceedValueThreshold(
                  reward.coin.coinType,
                  reward.amount
                );
              if (!rewardExceededThreshold) {
                return new BN(0);
              }

              return this.swapPositionRewardToPoolToken(
                position,
                { coin: coinX, object: removedX as any },
                {
                  coin: reward.coin,
                  object: tx.splitCoins(reward.object, [
                    reward.amount.toString(),
                  ]),
                },
                reward.amount
              )(tx);
            })
          )
        ).reduce(
          (acc, convertedAmount) => acc.add(new BN(convertedAmount)),
          new BN(0)
        );

        const { zapAmount, amountOut } = await this.zap(
          positionThatWillBeCreated,
          { coin: coinX, object: removedX as any },
          { coin: coinY, object: removedY as any },
          remainingX.add(totalConvertedAmount)
        )(tx);

        expectedMintAmounts.amountX = expectedMintAmounts.amountX
          .add(totalConvertedAmount)
          .sub(zapAmount);
        expectedMintAmounts.amountY = expectedMintAmounts.amountY.add(
          new BN(amountOut)
        );
      } else if (remainingY.gt(this.minZapAmounts.amountY)) {
        const totalConvertedAmount = (
          await Promise.all(
            nonPoolTokenRewards.map(async (reward) => {
              const rewardExceededThreshold =
                await this.doesRewardExceedValueThreshold(
                  reward.coin.coinType,
                  reward.amount
                );
              if (!rewardExceededThreshold) {
                return new BN(0);
              }

              return this.swapPositionRewardToPoolToken(
                position,
                { coin: coinY, object: removedY as any },
                {
                  coin: reward.coin,
                  object: tx.splitCoins(reward.object, [
                    reward.amount.toString(),
                  ]),
                },
                reward.amount
              )(tx);
            })
          )
        ).reduce(
          (acc, convertedAmount) => acc.add(new BN(convertedAmount)),
          new BN(0)
        );

        const { zapAmount, amountOut } = await this.zap(
          positionThatWillBeCreated,
          { coin: coinY, object: removedY as any },
          { coin: coinX, object: removedX as any },
          remainingY.add(totalConvertedAmount)
        )(tx);

        expectedMintAmounts.amountY = expectedMintAmounts.amountY
          .add(totalConvertedAmount)
          .sub(zapAmount);
        expectedMintAmounts.amountX = expectedMintAmounts.amountX.add(
          new BN(amountOut)
        );
      }

      positionThatWillBeCreated = Position.fromAmounts({
        owner: position.owner,
        pool: position.pool,
        tickLower,
        tickUpper,
        amountX: expectedMintAmounts.amountX,
        amountY: expectedMintAmounts.amountY,
        useFullPrecision: false,
      });

      const newPositionObj = positionManager.increaseLiquidity(
        positionThatWillBeCreated,
        {
          coinXIn: removedX,
          coinYIn: removedY,
          slippageTolerance: this.slippageTolerance,
          deadline: Number.MAX_SAFE_INTEGER,
          createPosition: true,
        }
      )(tx) as TransactionResult;

      // Transfer new position object to the owner
      tx.transferObjects([newPositionObj], position.owner);

      // Transfer non-pool token rewards to the owner
      if (nonPoolTokenRewards.length > 0) {
        refundTokensIfNecessary(
          nonPoolTokenRewards.map((reward) => ({
            objectCoin: reward.object,
            coinType: reward.coin.coinType,
          })),
          position.owner
        )(tx);
      }
    };

  compound = (position: Position) => async (tx: Transaction) => {
    const positionManager = createPositionManager(
      (position.pool as Pool).protocol
    );
    const [coinX, coinY] = [position.pool.coinX, position.pool.coinY];
    const [feeAmounts, rewardAmounts] = await Promise.all([
      position.getFees(),
      position.getRewards(),
    ]);

    const [collectedX, collectedY] = positionManager.collect(position, {})(tx);

    const poolTokenRewards = {
      amountX: new BN(0),
      amountY: new BN(0),
    };
    const nonPoolTokenRewards: {
      coin: Coin;
      object: TransactionResult;
      amount: BN;
    }[] = [];
    position.pool.poolRewards.forEach(async (rewardInfo, idx) => {
      if (rewardAmounts[idx].gt(new BN(0))) {
        const collectedReward = positionManager.collectReward(position, {
          rewardCoin: rewardInfo.coin,
        })(tx);

        if (rewardInfo.coin.equals(coinX)) {
          poolTokenRewards.amountX = poolTokenRewards.amountX.add(
            rewardAmounts[idx]
          );
          tx.mergeCoins(collectedX, [collectedReward]);
        } else if (rewardInfo.coin.equals(coinY)) {
          poolTokenRewards.amountY = poolTokenRewards.amountY.add(
            rewardAmounts[idx]
          );
          tx.mergeCoins(collectedY, [collectedReward]);
        } else {
          nonPoolTokenRewards.push({
            coin: rewardInfo.coin,
            object: collectedReward,
            amount: rewardAmounts[idx],
          });
        }
      }
    });

    const expectedMintAmounts = {
      amountX: feeAmounts.amountX.add(poolTokenRewards.amountX),
      amountY: feeAmounts.amountY.add(poolTokenRewards.amountY),
    };

    let positionThatWillBeIncreased = Position.fromAmounts({
      owner: position.owner,
      pool: position.pool,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      amountX: expectedMintAmounts.amountX,
      amountY: expectedMintAmounts.amountY,
      useFullPrecision: true,
    });
    (positionThatWillBeIncreased as any)["id"] = position.id;

    let remainingX = expectedMintAmounts.amountX.sub(
      positionThatWillBeIncreased.mintAmounts.amountX
    );
    let remainingY = expectedMintAmounts.amountY.sub(
      positionThatWillBeIncreased.mintAmounts.amountY
    );

    if (remainingX.gt(this.minZapAmounts.amountX)) {
      const totalConvertedAmount = (
        await Promise.all(
          nonPoolTokenRewards.map(async (reward) => {
            const rewardExceededThreshold =
              await this.doesRewardExceedValueThreshold(
                reward.coin.coinType,
                reward.amount
              );
            if (!rewardExceededThreshold) {
              return new BN(0);
            }

            return this.swapPositionRewardToPoolToken(
              position,
              { coin: coinX, object: collectedX as any },
              {
                coin: reward.coin,
                object: tx.splitCoins(reward.object, [
                  reward.amount.toString(),
                ]),
              },
              reward.amount
            )(tx);
          })
        )
      ).reduce(
        (acc, convertedAmount) => acc.add(new BN(convertedAmount)),
        new BN(0)
      );

      const { zapAmount, amountOut } = await this.zap(
        positionThatWillBeIncreased,
        { coin: coinX, object: collectedX as any },
        { coin: coinY, object: collectedY as any },
        remainingX.add(totalConvertedAmount)
      )(tx);

      expectedMintAmounts.amountX = expectedMintAmounts.amountX
        .add(totalConvertedAmount)
        .sub(zapAmount);
      expectedMintAmounts.amountY = expectedMintAmounts.amountY.add(
        new BN(amountOut)
      );
    } else if (remainingY.gt(this.minZapAmounts.amountY)) {
      const totalConvertedAmount = (
        await Promise.all(
          nonPoolTokenRewards.map(async (reward) => {
            const rewardExceededThreshold =
              await this.doesRewardExceedValueThreshold(
                reward.coin.coinType,
                reward.amount
              );
            if (!rewardExceededThreshold) {
              return new BN(0);
            }

            return this.swapPositionRewardToPoolToken(
              position,
              { coin: coinY, object: collectedY as any },
              {
                coin: reward.coin,
                object: tx.splitCoins(reward.object, [
                  reward.amount.toString(),
                ]),
              },
              reward.amount
            )(tx);
          })
        )
      ).reduce(
        (acc, convertedAmount) => acc.add(new BN(convertedAmount)),
        new BN(0)
      );

      const { zapAmount, amountOut } = await this.zap(
        positionThatWillBeIncreased,
        { coin: coinY, object: collectedY as any },
        { coin: coinX, object: collectedX as any },
        remainingY.add(totalConvertedAmount)
      )(tx);

      expectedMintAmounts.amountY = expectedMintAmounts.amountY
        .add(totalConvertedAmount)
        .sub(zapAmount);
      expectedMintAmounts.amountX = expectedMintAmounts.amountX.add(
        new BN(amountOut)
      );
    }

    positionManager.increaseLiquidity(positionThatWillBeIncreased, {
      coinXIn: collectedX,
      coinYIn: collectedY,
      slippageTolerance: this.slippageTolerance,
      deadline: Number.MAX_SAFE_INTEGER,
    })(tx);

    // Transfer non-pool token rewards to the owner
    if (nonPoolTokenRewards.length > 0) {
      refundTokensIfNecessary(
        nonPoolTokenRewards.map((reward) => ({
          objectCoin: reward.object,
          coinType: reward.coin.coinType,
        })),
        position.owner
      )(tx);
    }
  };
}
