import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { nowInMilliseconds, Percent } from "@flowx-finance/sdk";
import BN from "bn.js";
import invariant from "tiny-invariant";

import {
  createPositionProvider,
  Pool,
  IPositionProvider,
  Position,
} from "./entities";
import { jsonRpcProvider } from "./utils/jsonRpcProvider";
import { closestActiveRange, isOutOfRange } from "./utils/poolHelper";
import { PositionManager } from "./PositionManager";
import { sleep } from "./utils/thread";
import { getLogger } from "./utils/Logger";
import { tickToPrice } from "./utils/priceTickConversions";
import { PriceRange } from "./utils/PriceRange";
import { CachingSuiTransactionExecutor } from "./sui-tx-execution/CachingSuiTransactionExecutor";
import { ClmmProtocol, MAPPING_POSITION_OBJECT_TYPE } from "./constants";

export type WorkerOptions = {
  protocol: ClmmProtocol;
  poolId: string;
  bPricePercent: Percent;
  tPricePercent: Percent;
  slippageTolerance: Percent;
  priceImpactPercentThreshold?: Percent;
  minZapAmount: { amountX: BigInt | number; amountY: BigInt | number };
  multiplier: number;
  rewardThresholdUsd: number;
  compoundRewardsScheduleMs: number;
  trackingVolumeAddress?: string;
};

export class Worker {
  private isStarted = false;
  private nextTickTimer = 5000;
  private processingTimeout = 300000;
  private lastCompoundRewardAt: number;

  private poolId: string;
  private signer: Ed25519Keypair;
  private bPricePercent: Percent;
  private tPricePercent: Percent;
  private positionManager: PositionManager;
  private multiplier: number;
  private compoundRewardsScheduleMs: number;
  private txExecutor: CachingSuiTransactionExecutor;
  private logger = getLogger(module);

  private position: Position;
  private positionProvider: IPositionProvider;

  constructor(options: WorkerOptions, privateKey: string) {
    this.poolId = options.poolId;
    this.signer = Ed25519Keypair.fromSecretKey(
      decodeSuiPrivateKey(privateKey).secretKey
    );
    this.bPricePercent = options.bPricePercent;
    this.tPricePercent = options.tPricePercent;
    this.positionManager = new PositionManager({
      slippageTolerance: options.slippageTolerance,
      priceImpactPercentThreshold: options.priceImpactPercentThreshold,
      minZapAmounts: {
        amountX: new BN(options.minZapAmount.amountX.toString()),
        amountY: new BN(options.minZapAmount.amountY.toString()),
      },
      rewardThresholdUsd: !isNaN(options.rewardThresholdUsd)
        ? new BN(options.rewardThresholdUsd)
        : undefined,
      trackingVolumeAddress: options.trackingVolumeAddress,
    });
    this.multiplier = options.multiplier;
    this.compoundRewardsScheduleMs = options.compoundRewardsScheduleMs;
    this.txExecutor = new CachingSuiTransactionExecutor({
      client: jsonRpcProvider,
    });
    this.positionProvider = createPositionProvider(options.protocol);
  }

  public getNextTickTimer(): number {
    return this.nextTickTimer;
  }

  public getProcessingTimeout(): number {
    return this.processingTimeout;
  }

  public start(): void {
    if (this.isStarted) {
      this.logger.warn(
        `Trying to start processor twice: ${this.constructor.name}`
      );
      return;
    }

    this.isStarted = true;
    this.lastCompoundRewardAt = nowInMilliseconds();

    this.onTick();
  }

  private onTick(): void {
    const duration = this.getProcessingTimeout();
    const timer = setTimeout(async () => {
      this.logger.error(
        `onTick timeout (${duration} ms) is exceeded. Worker will be restarted shortly...`
      );
      process.exit(1);
    }, duration);

    this.doProcess()
      .then(() => {
        clearTimeout(timer);
        setTimeout(() => {
          this.onTick();
        }, this.getNextTickTimer());
      })
      .catch((err) => {
        clearTimeout(timer);
        this.logger.error(
          `The worker will be restarted shortly due to error: `,
          err
        );
        setTimeout(() => {
          this.onTick();
        }, this.getNextTickTimer());
      });
  }

  private async doProcess() {
    await this.synchronize();
    this.logger.info(
      `Start tracking position ${JSON.stringify({
        id: this.position.id,
        tickLower: this.position.tickLower,
        tickUpper: this.position.tickUpper,
        liquidity: this.position.liquidity.toString(),
        [this.position.pool.coins[0].symbol]: this.position.amountX.toExact({
          decimalSeparator: ".",
          groupSeparator: "",
        }),
        [this.position.pool.coins[1].symbol]: this.position.amountY.toExact({
          decimalSeparator: ".",
          groupSeparator: "",
        }),
      })}`
    );

    await this.rebalanceIfNecessary();
    await this.compoundIfNecessary();
  }

  private async synchronize() {
    if (!this.position) {
      this.position = await this.positionProvider.getLargestPosition(
        this.signer.toSuiAddress(),
        this.poolId
      );
    } else {
      this.position = await this.positionProvider.getPositionById(
        this.position.id
      );
    }
  }

  private async rebalanceIfNecessary() {
    const pool = this.position.pool;
    const activeTicks = closestActiveRange(pool, this.multiplier);
    const activePriceRange = new PriceRange(
      activeTicks[0],
      activeTicks[1],
      this.bPricePercent,
      this.tPricePercent
    );

    let [targetTickLower, targetTickUpper] = isOutOfRange(
      this.position,
      this.multiplier
    )
      ? [activeTicks[0], activeTicks[1]]
      : [this.position.tickLower, this.position.tickUpper];
    const currentSqrtPriceX64 = new BN(pool.sqrtPriceX64);
    if (currentSqrtPriceX64.lt(activePriceRange.bPriceLower)) {
      targetTickLower = activeTicks[0] - pool.tickSpacing;
      targetTickUpper = activeTicks[1];
    } else if (currentSqrtPriceX64.gt(activePriceRange.bPriceUpper)) {
      targetTickLower = activeTicks[0];
      targetTickUpper = activeTicks[1] + pool.tickSpacing;
    } else if (
      currentSqrtPriceX64.gt(activePriceRange.tPriceLower) &&
      currentSqrtPriceX64.lt(activePriceRange.tPriceUpper)
    ) {
      targetTickLower = activeTicks[0];
      targetTickUpper = activeTicks[1];
    }

    this.logger.info(
      `Current pool state ${JSON.stringify({
        currentTick: pool.tickCurrent,
        currentPrice: pool.sqrtPriceX64,
      })}, active price range [${activeTicks[0]},${
        activeTicks[1]
      }][${tickToPrice(
        pool.coinX,
        pool.coinY,
        activeTicks[0]
      ).asFraction.toFixed(4)}-${tickToPrice(
        pool.coinX,
        pool.coinY,
        activeTicks[1]
      ).asFraction.toFixed(
        4
      )}], target price range [${targetTickLower},${targetTickUpper}][${tickToPrice(
        pool.coinX,
        pool.coinY,
        targetTickLower
      ).asFraction.toFixed(4)}-${tickToPrice(
        pool.coinX,
        pool.coinY,
        targetTickUpper
      ).asFraction.toFixed(4)}]`
    );

    if (
      targetTickLower !== this.position.tickLower ||
      targetTickUpper !== this.position.tickUpper
    ) {
      const positionThatWillBeRebalanced = new Position({
        objectId: this.position.id,
        owner: this.position.owner,
        pool,
        tickLower: this.position.tickLower,
        tickUpper: this.position.tickUpper,
        liquidity: this.position.liquidity,
        coinsOwedX: this.position.coinsOwedX,
        coinsOwedY: this.position.coinsOwedY,
        feeGrowthInsideXLast: this.position.feeGrowthInsideXLast,
        feeGrowthInsideYLast: this.position.feeGrowthInsideYLast,
        rewardInfos: this.position.rewardInfos,
      });

      const newPositionId = await this.executeRebalance(
        positionThatWillBeRebalanced,
        targetTickLower,
        targetTickUpper
      );
      this.lastCompoundRewardAt = nowInMilliseconds();

      if (!!newPositionId) {
        await sleep(5000);
        this.position = await this.positionProvider.getPositionById(
          newPositionId
        );
      } else {
        delete this.position;
      }
    }
  }

  private async compoundIfNecessary() {
    const elapsedTimeMs = nowInMilliseconds() - this.lastCompoundRewardAt;
    if (
      !isNaN(this.compoundRewardsScheduleMs) &&
      elapsedTimeMs > this.compoundRewardsScheduleMs
    ) {
      await this.executeCompound(this.position);
      this.lastCompoundRewardAt = nowInMilliseconds();
    }
  }

  private async executeRebalance(
    position: Position,
    tickLower: number,
    tickUpper: number
  ) {
    try {
      const tx = new Transaction();
      await this.positionManager.migrate(position, tickLower, tickUpper)(tx);

      const res = await jsonRpcProvider.signAndExecuteTransaction({
        transaction: tx,
        signer: this.signer,
        options: {
          showEffects: true,
          showObjectChanges: true,
        },
      });
      invariant(
        res.effects.status.status == "success",
        res.effects.status.error
      );

      const createdPosition = res.objectChanges?.find(
        (obj) =>
          obj.type === "created" &&
          obj.objectType ===
            MAPPING_POSITION_OBJECT_TYPE[(position.pool as Pool).protocol]
      )?.["objectId"];
      this.logger.info(
        `Rebalance position successful, price_range=[${tickLower},${tickUpper}], position_id=${createdPosition}, tx_digest=${res.digest}`
      );

      return createdPosition;
    } catch (error) {
      this.logger.error(
        `Error during rebalance position=${position.id}`,
        error
      );
      throw error;
    }
  }

  private async executeCompound(position: Position) {
    try {
      const tx = new Transaction();
      await this.positionManager.compound(position)(tx);

      const res = await jsonRpcProvider.signAndExecuteTransaction({
        transaction: tx,
        signer: this.signer,
        options: {
          showEffects: true,
          showObjectChanges: true,
        },
      });
      invariant(
        res.effects.status.status == "success",
        res.effects.status.error
      );
      this.logger.info(
        `Compound position successful, position_id=${position.id}, tx_digest=${res.digest}`
      );
    } catch (error) {
      this.logger.error(`Error during compound position=${position.id}`, error);
      throw error;
    }
  }
}
