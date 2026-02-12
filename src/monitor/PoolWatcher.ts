/**
 * Pool Watcher
 * Monitors pool state including current tick, price, and liquidity
 */

import { Pool } from "../entities";
import { getLogger } from "../utils/Logger";

const logger = getLogger(module);

/**
 * Pool state monitoring interface
 */
export interface PoolState {
  poolId: string;
  currentTick: number;
  sqrtPriceX64: string;
  liquidity: string;
  feeGrowthGlobalX: string;
  feeGrowthGlobalY: string;
  timestamp: number;
}

/**
 * PoolWatcher class
 * Monitors and tracks pool state changes
 */
export class PoolWatcher {
  private poolId: string;
  private lastState: PoolState | null = null;

  constructor(poolId: string) {
    this.poolId = poolId;
    logger.info(`PoolWatcher: Initialized for pool ${poolId}`);
  }

  /**
   * Fetch current pool state from on-chain data
   * @param pool - Pool object from provider
   * @returns Current pool state
   */
  async getPoolState(pool: Pool): Promise<PoolState> {
    const state: PoolState = {
      poolId: pool.id,
      currentTick: pool.tickCurrent,
      sqrtPriceX64: pool.sqrtPriceX64,
      liquidity: pool.liquidity,
      feeGrowthGlobalX: pool.feeGrowthGlobalX,
      feeGrowthGlobalY: pool.feeGrowthGlobalY,
      timestamp: Date.now(),
    };

    // Log state changes
    if (this.lastState) {
      if (this.lastState.currentTick !== state.currentTick) {
        logger.info(
          `PoolWatcher: Tick changed from ${this.lastState.currentTick} to ${state.currentTick}`
        );
      }
      if (this.lastState.sqrtPriceX64 !== state.sqrtPriceX64) {
        logger.info(
          `PoolWatcher: Price changed from ${this.lastState.sqrtPriceX64} to ${state.sqrtPriceX64}`
        );
      }
    }

    this.lastState = state;
    return state;
  }

  /**
   * Get the last recorded pool state
   */
  getLastState(): PoolState | null {
    return this.lastState;
  }

  /**
   * Get pool ID being monitored
   */
  getPoolId(): string {
    return this.poolId;
  }
}
