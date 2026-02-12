/**
 * Position Watcher
 * Monitors position state including liquidity, tick range, and in-range status
 */

import BN from "bn.js";
import { Position } from "../entities";
import { getLogger } from "../utils/Logger";
import { ZERO } from "../utils/sdkTypes";

const logger = getLogger(module);

/**
 * Position state for monitoring
 */
export interface PositionState {
  positionId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  currentTick: number;
  isInRange: boolean;
  timestamp: number;
}

/**
 * PositionWatcher class
 * Monitors and tracks position state and range status
 */
export class PositionWatcher {
  private positionId: string;
  private lastState: PositionState | null = null;

  constructor(positionId: string) {
    this.positionId = positionId;
    logger.info(`PositionWatcher: Initialized for position ${positionId}`);
  }

  /**
   * Check if position is in range
   * Uses inclusive boundaries: currentTick >= tickLower && currentTick <= tickUpper
   * @param position - Position object
   * @returns true if position is in range
   */
  isPositionInRange(position: Position): boolean {
    const currentTick = position.pool.tickCurrent;
    const tickLower = position.tickLower;
    const tickUpper = position.tickUpper;

    // Inclusive range check as per problem statement
    return currentTick >= tickLower && currentTick <= tickUpper;
  }

  /**
   * Validate position has valid tick range
   * @param position - Position object
   * @returns true if tick range is valid
   */
  isValidTickRange(position: Position): boolean {
    // Check for falsy values (0, undefined, null) or invalid range
    // Note: 0 indicates parsing failure, so it's treated as invalid
    if (
      !position.tickLower ||
      !position.tickUpper ||
      position.tickLower >= position.tickUpper
    ) {
      logger.warn(
        `PositionWatcher: Invalid tick range - lower: ${position.tickLower}, upper: ${position.tickUpper}`
      );
      return false;
    }
    return true;
  }

  /**
   * Check if position has liquidity
   * @param position - Position object
   * @returns true if position has non-zero liquidity
   */
  hasLiquidity(position: Position): boolean {
    return new BN(position.liquidity).gt(ZERO);
  }

  /**
   * Get current position state
   * @param position - Position object
   * @returns Current position state
   */
  getPositionState(position: Position): PositionState {
    const isInRange = this.isPositionInRange(position);
    const currentTick = position.pool.tickCurrent;

    const state: PositionState = {
      positionId: position.id,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      liquidity: position.liquidity,
      currentTick,
      isInRange,
      timestamp: Date.now(),
    };

    // Log range status changes
    if (this.lastState && this.lastState.isInRange !== isInRange) {
      if (isInRange) {
        logger.info(
          `PositionWatcher: Position ${position.id} is now IN RANGE (tick: ${currentTick})`
        );
      } else {
        logger.warn(
          `PositionWatcher: Position ${position.id} is now OUT OF RANGE (tick: ${currentTick}, range: [${position.tickLower}, ${position.tickUpper}])`
        );
      }
    }

    this.lastState = state;
    return state;
  }

  /**
   * Get the last recorded position state
   */
  getLastState(): PositionState | null {
    return this.lastState;
  }
}
