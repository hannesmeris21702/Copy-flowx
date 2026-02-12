import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { nowInMilliseconds, Percent, ZERO } from "./utils/sdkTypes";
import BN from "bn.js";
import invariant from "tiny-invariant";

import {
  createPositionProvider,
  Pool,
  IPositionProvider,
  Position,
} from "./entities";
import { jsonRpcProvider } from "./utils/jsonRpcProvider";
import { closestActiveRange } from "./utils/poolHelper";
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
  private lastCompoundRewardAt: number = 0;

  private poolId: string;
  private signer: Ed25519Keypair;
  private bPricePercent: Percent;
  private tPricePercent: Percent;
  private positionManager: PositionManager;
  private multiplier: number;
  private compoundRewardsScheduleMs: number;
  private txExecutor: CachingSuiTransactionExecutor;
  private logger = getLogger(module);

  private position: Position | null = null;
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
    
    // Skip processing if no valid position
    if (!this.position) {
      this.logger.info("No valid active position found");
      return;
    }
    
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
      
      // Log if no valid position found
      if (!this.position) {
        this.logger.info("No valid active position found");
      }
    } else {
      this.position = await this.positionProvider.getPositionById(
        this.position.id
      );
    }
  }

  private async rebalanceIfNecessary() {
    // =================================================================
    // STEP 1: POSITION CHECK
    // =================================================================
    
    // Skip if no position exists
    if (!this.position) {
      this.logger.info("Rebalance: No position found, skipping");
      return;
    }

    // Skip if liquidity is zero
    if (new BN(this.position.liquidity).eq(ZERO)) {
      this.logger.info("Rebalance: Position has zero liquidity, skipping");
      return;
    }

    // Validate position tick range before proceeding
    // Check for falsy values (0, undefined, null) or invalid range
    // Note: 0 indicates parsing failure in parseTickIndex(), so it's treated as invalid
    if (!this.position.tickLower || !this.position.tickUpper || this.position.tickLower >= this.position.tickUpper) {
      this.logger.warn("Rebalance: Invalid tick range detected, skipping");
      return;
    }

    const pool = this.position.pool;
    const currentTick = pool.tickCurrent;
    const tickLower = this.position.tickLower;
    const tickUpper = this.position.tickUpper;

    this.logger.info(
      `Rebalance Step 1: Position check - Position ID: ${this.position.id}, ` +
      `tickLower: ${tickLower}, tickUpper: ${tickUpper}, ` +
      `liquidity: ${this.position.liquidity}, poolId: ${pool.id}`
    );

    // Fetch current pool tick from on-chain pool state
    this.logger.info(`Rebalance Step 1: Current pool tick: ${currentTick}`);

    // Determine if position is in range
    // Per problem statement: isInRange = currentTick >= tickLower && currentTick <= tickUpper
    // Using inclusive boundaries on both ends as specified
    const isInRange = currentTick >= tickLower && currentTick <= tickUpper;
    this.logger.info(`Rebalance Step 1: Position isInRange: ${isInRange}`);

    // =================================================================
    // SAFETY RULE: Never rebalance if already in range
    // =================================================================
    if (isInRange) {
      this.logger.info("Rebalance: Position is in range, no rebalance needed");
      return;
    }

    // =================================================================
    // STEP 2: POSITION IS OUT OF RANGE - BEGIN REBALANCE
    // =================================================================
    this.logger.info("Rebalance Step 2: Position is OUT OF RANGE, starting rebalance process");

    // =================================================================
    // STEP 3: CALCULATE NEW ACTIVE RANGE
    // =================================================================
    this.logger.info("Rebalance Step 3: Calculating new active range");

    // Use closestActiveRange which already uses config parameters (multiplier)
    const activeTicks = closestActiveRange(pool, this.multiplier);
    let [newLowerTick, newUpperTick] = activeTicks;

    // Apply bPricePercent and tPricePercent adjustments
    let activePriceRange: PriceRange;
    try {
      activePriceRange = new PriceRange(
        activeTicks[0],
        activeTicks[1],
        this.bPricePercent,
        this.tPricePercent
      );
    } catch (error) {
      this.logger.warn("Rebalance: Failed to create price range, skipping rebalance", error);
      return;
    }

    // Adjust range based on current price position
    const currentSqrtPriceX64 = new BN(pool.sqrtPriceX64);
    if (currentSqrtPriceX64.lt(activePriceRange.bPriceLower)) {
      newLowerTick = activeTicks[0] - pool.tickSpacing;
      newUpperTick = activeTicks[1];
    } else if (currentSqrtPriceX64.gt(activePriceRange.bPriceUpper)) {
      newLowerTick = activeTicks[0];
      newUpperTick = activeTicks[1] + pool.tickSpacing;
    } else if (
      currentSqrtPriceX64.gt(activePriceRange.tPriceLower) &&
      currentSqrtPriceX64.lt(activePriceRange.tPriceUpper)
    ) {
      newLowerTick = activeTicks[0];
      newUpperTick = activeTicks[1];
    }

    // Ensure ticks are properly aligned to tickSpacing (defensive programming)
    newLowerTick = Math.round(newLowerTick / pool.tickSpacing) * pool.tickSpacing;
    newUpperTick = Math.round(newUpperTick / pool.tickSpacing) * pool.tickSpacing;

    // =================================================================
    // SAFETY RULE: Validate new tick range
    // Ensure new range is valid and contains current tick
    // Using inclusive boundaries: newLowerTick <= currentTick <= newUpperTick
    // =================================================================
    if (newLowerTick >= newUpperTick) {
      this.logger.error(
        `Rebalance: Invalid new tick range calculated: ` +
        `newLowerTick=${newLowerTick}, newUpperTick=${newUpperTick}`
      );
      return;
    }

    if (newLowerTick > currentTick || newUpperTick < currentTick) {
      this.logger.error(
        `Rebalance: New tick range does not contain current tick: ` +
        `newLowerTick=${newLowerTick}, currentTick=${currentTick}, newUpperTick=${newUpperTick}`
      );
      return;
    }

    this.logger.info(
      `Rebalance Step 3: New active range calculated - ` +
      `newLowerTick: ${newLowerTick}, newUpperTick: ${newUpperTick}, ` +
      `currentTick: ${currentTick}`
    );

    this.logger.info(
      `Rebalance: Price range details - ` +
      `Current tick: ${currentTick}, ` +
      `Current price: ${pool.sqrtPriceX64}, ` +
      `Active range: [${activeTicks[0]}, ${activeTicks[1]}] ` +
      `[${tickToPrice(pool.coinX, pool.coinY, activeTicks[0]).asFraction.toFixed(4)}-` +
      `${tickToPrice(pool.coinX, pool.coinY, activeTicks[1]).asFraction.toFixed(4)}], ` +
      `Target range: [${newLowerTick}, ${newUpperTick}] ` +
      `[${tickToPrice(pool.coinX, pool.coinY, newLowerTick).asFraction.toFixed(4)}-` +
      `${tickToPrice(pool.coinX, pool.coinY, newUpperTick).asFraction.toFixed(4)}]`
    );

    // =================================================================
    // STEP 4-7: EXECUTE REBALANCE
    // =================================================================
    // The actual removal, collection, closing, swapping, and position creation
    // is handled by executeRebalance which calls PositionManager.migrate
    this.logger.info(
      `Rebalance Step 4-7: Executing rebalance - ` +
      `removing liquidity, collecting fees/rewards, closing position, ` +
      `swapping if necessary, and creating new position`
    );

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
      newLowerTick,
      newUpperTick
    );
    this.lastCompoundRewardAt = nowInMilliseconds();

    if (!!newPositionId) {
      this.logger.info(`Rebalance: Success! New position created: ${newPositionId}`);
      await sleep(5000);
      this.position = await this.positionProvider.getPositionById(
        newPositionId
      );
    } else {
      this.logger.warn("Rebalance: Position creation failed, setting position to null");
      this.position = null;
    }
  }

  private async compoundIfNecessary() {
    // Skip if no position
    if (!this.position) {
      return;
    }
    
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
      this.logger.info(
        `ExecuteRebalance: Starting migration for position ${position.id} ` +
        `from [${position.tickLower}, ${position.tickUpper}] to [${tickLower}, ${tickUpper}]`
      );

      const tx = new Transaction();
      
      this.logger.info(
        `ExecuteRebalance: Calling PositionManager.migrate which will: ` +
        `(1) Remove liquidity, (2) Collect fees/rewards, (3) Close position, ` +
        `(4) Swap if necessary, (5) Create new position`
      );
      
      await this.positionManager.migrate(position, tickLower, tickUpper)(tx);

      this.logger.info(`ExecuteRebalance: Signing and executing transaction...`);
      
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
        `ExecuteRebalance: SUCCESS! New position created with ID: ${createdPosition}, ` +
        `tick range: [${tickLower}, ${tickUpper}], tx_digest: ${res.digest}`
      );

      return createdPosition;
    } catch (error) {
      this.logger.error(
        `ExecuteRebalance: ERROR during rebalance of position ${position.id}`,
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
