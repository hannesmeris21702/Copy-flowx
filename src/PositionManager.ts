import BN from "bn.js";
import BigNumber from "bignumber.js";
import invariant from "tiny-invariant";
import { Transaction, TransactionResult } from "@mysten/sui/transactions";
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
import { getLogger } from "./utils/Logger";

const logger = getLogger();

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

    this.priceProvider = priceProvider ?? new AggregatorPriceProvider();
  }

  // TODO: Implement swap routing using Cetus SDK Router for reward compounding
  // For now, rewards are collected but not swapped
  private async checkPriceImpact(
    tokenInType: string,
    tokenOutType: string,
    amountIn: BN,
    amountOut: BN
  ) {
    const [tokenIn, tokenOut] = await Promise.all([
      getToken(tokenInType),
      getToken(tokenOutType),
    ]);

    const [tokenInPriceUSD, tokenOutPriceUSD] = await Promise.all([
      this.priceProvider.getPrice(tokenInType),
      this.priceProvider.getPrice(tokenOutType),
    ]);

    const amountInUSD = new BigNumber(
      convertAmountToDecimalAmount(amountIn, tokenIn.decimals)
    ).multipliedBy(tokenInPriceUSD);
    const amountOutUSD = new BigNumber(
      convertAmountToDecimalAmount(amountOut, tokenOut.decimals)
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

  // Simplified version: collects reward tokens without swapping
  // TODO: Implement swap routing using Cetus SDK for full reward compounding
  swapPositionRewardToPoolToken =
    (
      position: Position,
      targetCoin: { coin: Coin; object: TransactionResult },
      rewardCoin: { coin: Coin; object: TransactionResult },
      amount: BN
    ) =>
    async (tx: Transaction) => {
      // For now, we just collect the reward without swapping
      // The reward coins will remain in the wallet
      logger.warn(`Collected ${amount.toString()} of reward coin ${rewardCoin.coin.coinType}`);
      logger.warn(`TODO: Implement swap to ${targetCoin.coin.coinType} using Cetus Router`);
      
      // Return zero since we're not swapping
      return new BN(0);
    };

  // Simplified zap: calculates zap amount but doesn't swap
  // TODO: Implement actual swap using Cetus SDK Router
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

      logger.warn(`Zap calculated: ${zapAmount.toString()} from ${sourceCoin.coin.coinType} to ${targetCoin.coin.coinType}`);
      logger.warn(`TODO: Implement swap using Cetus Router`);

      // For now, return zap amount but no actual swap occurred
      return {
        zapAmount,
        amountOut: new BN(0),
      };
    };

  migrate =
    (position: Position, tickLower: number, tickUpper: number) =>
    async (tx: Transaction) => {
      logger.info(
        `=== MIGRATE: Starting rebalance process ===`
      );
      logger.info(
        `Position ID: ${position.id}, ` +
        `Old range: [${position.tickLower}, ${position.tickUpper}], ` +
        `New range: [${tickLower}, ${tickUpper}]`
      );

      const positionManager = createPositionManager(
        (position.pool as Pool).protocol
      );
      const [coinX, coinY] = [position.pool.coinX, position.pool.coinY];
      const [feeAmounts, rewardAmounts] = await Promise.all([
        position.getFees(),
        position.getRewards(),
      ]);

      logger.info(
        `MIGRATE Step 1: Fee amounts - ` +
        `X: ${feeAmounts.amountX.toString()}, Y: ${feeAmounts.amountY.toString()}`
      );
      logger.info(
        `MIGRATE Step 1: Reward amounts - ` +
        `${rewardAmounts.map((r, i) => `[${i}]: ${r.toString()}`).join(', ')}`
      );

      // Step A: Remove ALL liquidity from the position
      logger.info(
        `MIGRATE Step 2: Removing liquidity (${position.liquidity}) from position`
      );
      const [removedX, removedY] = positionManager.decreaseLiquidity(position, {
        slippageTolerance: this.slippageTolerance,
        deadline: Number.MAX_SAFE_INTEGER,
      })(tx);
      logger.info(`MIGRATE Step 2: Liquidity removed successfully`);

      // Step B: Collect fees and rewards
      logger.info(`MIGRATE Step 3: Collecting fees and rewards`);
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
          logger.info(
            `MIGRATE Step 3: Collecting reward ${idx} ` +
            `(${rewardInfo.coin.symbol}): ${rewardAmounts[idx].toString()}`
          );
          const collectedReward = positionManager.collectReward(position, {
            rewardCoin: rewardInfo.coin,
          })(tx);

          if (rewardInfo.coin.equals(coinX)) {
            poolTokenRewards.amountX = poolTokenRewards.amountX.add(
              rewardAmounts[idx]
            );
            tx.mergeCoins(removedX, [collectedReward]);
            logger.info(`MIGRATE Step 3: Merged reward into coinX`);
          } else if (rewardInfo.coin.equals(coinY)) {
            poolTokenRewards.amountY = poolTokenRewards.amountY.add(
              rewardAmounts[idx]
            );
            tx.mergeCoins(removedY, [collectedReward]);
            logger.info(`MIGRATE Step 3: Merged reward into coinY`);
          } else {
            nonPoolTokenRewards.push({
              coin: rewardInfo.coin,
              object: collectedReward,
              amount: rewardAmounts[idx],
            });
            logger.info(`MIGRATE Step 3: Saved non-pool reward for later transfer`);
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

      logger.info(
        `MIGRATE Step 3: Total amounts after collection - ` +
        `X: ${expectedMintAmounts.amountX.toString()}, ` +
        `Y: ${expectedMintAmounts.amountY.toString()}`
      );

      // Step C: Close the old position
      logger.info(`MIGRATE Step 4: Closing old position ${position.id}`);
      positionManager.closePosition(position)(tx);
      logger.info(`MIGRATE Step 4: Old position closed`);

      // Calculate new position parameters
      logger.info(`MIGRATE Step 5: Calculating new position parameters`);
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

      logger.info(
        `MIGRATE Step 5: Remaining tokens after initial calculation - ` +
        `X: ${remainingX.toString()}, Y: ${remainingY.toString()}`
      );

      //Only one of the two assets, X or Y, is redundant when liquidity is added.
      // Step D: Swap if necessary to balance tokens
      if (remainingX.gt(this.minZapAmounts.amountX)) {
        logger.info(
          `MIGRATE Step 6: Need to swap excess X (${remainingX.toString()}) ` +
          `to balance tokens for new position`
        );
        
        const totalConvertedAmount = (
          await Promise.all(
            nonPoolTokenRewards.map(async (reward) => {
              const rewardExceededThreshold =
                await this.doesRewardExceedValueThreshold(
                  reward.coin.coinType,
                  reward.amount
                );
              if (!rewardExceededThreshold) {
                logger.info(
                  `MIGRATE Step 6: Reward ${reward.coin.symbol} ` +
                  `below threshold, skipping swap`
                );
                return new BN(0);
              }

              logger.info(
                `MIGRATE Step 6: Converting reward ${reward.coin.symbol} ` +
                `(${reward.amount.toString()}) to coinX`
              );
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

        logger.info(
          `MIGRATE Step 6: Executing zap swap from X to Y, ` +
          `amount: ${remainingX.add(totalConvertedAmount).toString()}`
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
        
        logger.info(
          `MIGRATE Step 6: Swap completed - ` +
          `zapAmount: ${zapAmount.toString()}, amountOut: ${amountOut.toString()}`
        );
      } else if (remainingY.gt(this.minZapAmounts.amountY)) {
        logger.info(
          `MIGRATE Step 6: Need to swap excess Y (${remainingY.toString()}) ` +
          `to balance tokens for new position`
        );
        
        const totalConvertedAmount = (
          await Promise.all(
            nonPoolTokenRewards.map(async (reward) => {
              const rewardExceededThreshold =
                await this.doesRewardExceedValueThreshold(
                  reward.coin.coinType,
                  reward.amount
                );
              if (!rewardExceededThreshold) {
                logger.info(
                  `MIGRATE Step 6: Reward ${reward.coin.symbol} ` +
                  `below threshold, skipping swap`
                );
                return new BN(0);
              }

              logger.info(
                `MIGRATE Step 6: Converting reward ${reward.coin.symbol} ` +
                `(${reward.amount.toString()}) to coinY`
              );
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

        logger.info(
          `MIGRATE Step 6: Executing zap swap from Y to X, ` +
          `amount: ${remainingY.add(totalConvertedAmount).toString()}`
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

        logger.info(
          `MIGRATE Step 6: Swap completed - ` +
          `zapAmount: ${zapAmount.toString()}, amountOut: ${amountOut.toString()}`
        );
      } else {
        logger.info(
          `MIGRATE Step 6: No swap needed - remaining amounts are within tolerance`
        );
      }

      // Step E: Create new position
      logger.info(
        `MIGRATE Step 7: Creating new position with balanced amounts - ` +
        `X: ${expectedMintAmounts.amountX.toString()}, ` +
        `Y: ${expectedMintAmounts.amountY.toString()}`
      );
      
      positionThatWillBeCreated = Position.fromAmounts({
        owner: position.owner,
        pool: position.pool,
        tickLower,
        tickUpper,
        amountX: expectedMintAmounts.amountX,
        amountY: expectedMintAmounts.amountY,
        useFullPrecision: false,
      });

      logger.info(
        `MIGRATE Step 7: Opening new position and adding liquidity - ` +
        `mintAmountX: ${positionThatWillBeCreated.mintAmounts.amountX.toString()}, ` +
        `mintAmountY: ${positionThatWillBeCreated.mintAmounts.amountY.toString()}`
      );

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

      logger.info(`MIGRATE Step 7: New position created successfully`);

      // Transfer new position object to the owner
      tx.transferObjects([newPositionObj], position.owner);
      logger.info(`MIGRATE Step 7: New position transferred to owner`);

      // Transfer non-pool token rewards to the owner
      if (nonPoolTokenRewards.length > 0) {
        logger.info(
          `MIGRATE Step 8: Transferring ${nonPoolTokenRewards.length} ` +
          `non-pool token rewards to owner`
        );
        refundTokensIfNecessary(
          nonPoolTokenRewards.map((reward) => ({
            objectCoin: reward.object,
            coinType: reward.coin.coinType,
          })),
          position.owner
        )(tx);
      }

      logger.info(`=== MIGRATE: Rebalance process completed successfully ===`);
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
