/**
 * Strategy Engine
 * Core rebalancing strategy logic and decision making
 */

import BN from "bn.js";
import { Pool, Position } from "../entities";
import { Percent, ZERO } from "../utils/sdkTypes";
import { getLogger } from "../utils/Logger";
import { PositionWatcher } from "../monitor/PositionWatcher";

const logger = getLogger(module);

/**
 * Strategy configuration
 */
export interface StrategyConfig {
  rangePercent: Percent; // Range width around current price
  slippageTolerance: Percent;
  maxPriceImpact: Percent;
  minLiquidity: BN;
  mode: "SAFE" | "AGGRESSIVE";
  rebalanceCooldownMs: number;
}

/**
 * Rebalance decision result
 */
export interface RebalanceDecision {
  shouldRebalance: boolean;
  reason: string;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  newTickLower?: number;
  newTickUpper?: number;
}

/**
 * Strategy class
 * Implements core rebalancing strategy and decision logic
 */
export class Strategy {
  private config: StrategyConfig;
  private lastRebalanceTime: number = 0;
  private positionWatcher: PositionWatcher;

  constructor(config: StrategyConfig) {
    this.config = config;
    this.positionWatcher = new PositionWatcher("");
    logger.info(`Strategy: Initialized with mode ${config.mode}`);
  }

  /**
   * Evaluate if position needs rebalancing
   * Returns decision with reasoning
   */
  evaluateRebalance(position: Position): RebalanceDecision {
    logger.info(`Strategy: Evaluating rebalance for position ${position.id}`);

    // STEP 1: Basic validation checks
    if (!position) {
      return {
        shouldRebalance: false,
        reason: "No position found",
        currentTick: 0,
        tickLower: 0,
        tickUpper: 0,
      };
    }

    // Check liquidity
    if (new BN(position.liquidity).lte(ZERO)) {
      return {
        shouldRebalance: false,
        reason: "Position has zero liquidity",
        currentTick: position.pool.tickCurrent,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
      };
    }

    // Validate tick range
    if (!this.positionWatcher.isValidTickRange(position)) {
      return {
        shouldRebalance: false,
        reason: "Invalid tick range",
        currentTick: position.pool.tickCurrent,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
      };
    }

    // STEP 2: Check cooldown period
    const now = Date.now();
    const timeSinceLastRebalance = now - this.lastRebalanceTime;
    
    if (
      this.lastRebalanceTime > 0 &&
      timeSinceLastRebalance < this.config.rebalanceCooldownMs
    ) {
      return {
        shouldRebalance: false,
        reason: `Cooldown period active (${Math.floor(timeSinceLastRebalance / 1000)}s / ${Math.floor(this.config.rebalanceCooldownMs / 1000)}s)`,
        currentTick: position.pool.tickCurrent,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
      };
    }

    // STEP 3: Check if position is in range
    const currentTick = position.pool.tickCurrent;
    const tickLower = position.tickLower;
    const tickUpper = position.tickUpper;
    const isInRange = this.positionWatcher.isPositionInRange(position);

    logger.info(
      `Strategy: Position range check - Current tick: ${currentTick}, ` +
        `Range: [${tickLower}, ${tickUpper}], In range: ${isInRange}`
    );

    // SAFETY RULE: Never rebalance if already in range
    if (isInRange) {
      return {
        shouldRebalance: false,
        reason: "Position is in range",
        currentTick,
        tickLower,
        tickUpper,
      };
    }

    // STEP 4: Position is out of range - trigger rebalance
    logger.warn(
      `Strategy: Position OUT OF RANGE - Current tick: ${currentTick}, ` +
        `Range: [${tickLower}, ${tickUpper}]`
    );

    return {
      shouldRebalance: true,
      reason: "Position is out of range",
      currentTick,
      tickLower,
      tickUpper,
    };
  }

  /**
   * Record that a rebalance was executed
   */
  recordRebalance(): void {
    this.lastRebalanceTime = Date.now();
    logger.info(`Strategy: Rebalance recorded at ${new Date().toISOString()}`);
  }

  /**
   * Get time since last rebalance in milliseconds
   */
  getTimeSinceLastRebalance(): number {
    if (this.lastRebalanceTime === 0) {
      return -1;
    }
    return Date.now() - this.lastRebalanceTime;
  }

  /**
   * Get strategy configuration
   */
  getConfig(): StrategyConfig {
    return this.config;
  }

  /**
   * Update strategy configuration
   */
  updateConfig(config: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info(`Strategy: Configuration updated`);
  }
}
