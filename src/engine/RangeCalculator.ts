/**
 * Range Calculator
 * Calculates optimal tick ranges for positions based on current price and strategy
 */

import BN from "bn.js";
import { Pool } from "../entities";
import { Percent } from "../utils/sdkTypes";
import { getLogger } from "../utils/Logger";
import { closestActiveRange } from "../utils/poolHelper";
import { PriceRange } from "../utils/PriceRange";

const logger = getLogger(module);

/**
 * Tick range result
 */
export interface TickRange {
  tickLower: number;
  tickUpper: number;
  isValid: boolean;
  reason?: string;
}

/**
 * RangeCalculator class
 * Calculates new tick ranges centered around current pool price
 */
export class RangeCalculator {
  private bPricePercent: Percent;
  private tPricePercent: Percent;
  private multiplier: number;

  constructor(
    bPricePercent: Percent,
    tPricePercent: Percent,
    multiplier: number = 1
  ) {
    this.bPricePercent = bPricePercent;
    this.tPricePercent = tPricePercent;
    this.multiplier = multiplier;
    logger.info(
      `RangeCalculator: Initialized - bPrice: ${bPricePercent.toFixed(2)}%, ` +
        `tPrice: ${tPricePercent.toFixed(2)}%, multiplier: ${multiplier}`
    );
  }

  /**
   * Calculate new optimal range centered around current tick
   * @param pool - Pool object with current state
   * @returns New tick range
   */
  calculateOptimalRange(pool: Pool): TickRange {
    logger.info(`RangeCalculator: Calculating optimal range for pool ${pool.id}`);

    try {
      // Use closestActiveRange to get base range using multiplier
      const activeTicks = closestActiveRange(pool, this.multiplier);
      let [newLowerTick, newUpperTick] = activeTicks;

      logger.info(
        `RangeCalculator: Base active range - [${newLowerTick}, ${newUpperTick}]`
      );

      // Create price range with configured percentages
      let activePriceRange: PriceRange;
      try {
        activePriceRange = new PriceRange(
          activeTicks[0],
          activeTicks[1],
          this.bPricePercent,
          this.tPricePercent
        );
      } catch (error) {
        logger.error("RangeCalculator: Failed to create price range", error);
        return {
          tickLower: 0,
          tickUpper: 0,
          isValid: false,
          reason: "Failed to create price range",
        };
      }

      // Adjust range based on current price position
      const currentSqrtPriceX64 = new BN(pool.sqrtPriceX64);
      const currentTick = pool.tickCurrent;

      if (currentSqrtPriceX64.lt(activePriceRange.bPriceLower)) {
        // Price is below range - extend lower
        newLowerTick = activeTicks[0] - pool.tickSpacing;
        newUpperTick = activeTicks[1];
        logger.info(
          `RangeCalculator: Price below range, extending lower to ${newLowerTick}`
        );
      } else if (currentSqrtPriceX64.gt(activePriceRange.bPriceUpper)) {
        // Price is above range - extend upper
        newLowerTick = activeTicks[0];
        newUpperTick = activeTicks[1] + pool.tickSpacing;
        logger.info(
          `RangeCalculator: Price above range, extending upper to ${newUpperTick}`
        );
      } else if (
        currentSqrtPriceX64.gt(activePriceRange.tPriceLower) &&
        currentSqrtPriceX64.lt(activePriceRange.tPriceUpper)
      ) {
        // Price is in target range
        newLowerTick = activeTicks[0];
        newUpperTick = activeTicks[1];
        logger.info("RangeCalculator: Price in target range, using base range");
      }

      // Validate the calculated range
      return this.validateRange(newLowerTick, newUpperTick, currentTick, pool);
    } catch (error) {
      logger.error("RangeCalculator: Error calculating range", error);
      return {
        tickLower: 0,
        tickUpper: 0,
        isValid: false,
        reason: `Calculation error: ${error.message}`,
      };
    }
  }

  /**
   * Validate that the calculated range is valid
   * @param tickLower - Lower tick
   * @param tickUpper - Upper tick
   * @param currentTick - Current pool tick
   * @param pool - Pool object
   * @returns Validated tick range
   */
  private validateRange(
    tickLower: number,
    tickUpper: number,
    currentTick: number,
    pool: Pool
  ): TickRange {
    // Check that lower < upper
    if (tickLower >= tickUpper) {
      logger.error(
        `RangeCalculator: Invalid range - lower (${tickLower}) >= upper (${tickUpper})`
      );
      return {
        tickLower,
        tickUpper,
        isValid: false,
        reason: "Lower tick must be less than upper tick",
      };
    }

    // Check that current tick is within range (inclusive)
    if (tickLower > currentTick || tickUpper < currentTick) {
      logger.error(
        `RangeCalculator: Range does not contain current tick - ` +
          `Range: [${tickLower}, ${tickUpper}], Current: ${currentTick}`
      );
      return {
        tickLower,
        tickUpper,
        isValid: false,
        reason: "Range does not contain current tick",
      };
    }

    logger.info(
      `RangeCalculator: Valid range calculated - [${tickLower}, ${tickUpper}] ` +
        `contains current tick ${currentTick}`
    );

    return {
      tickLower,
      tickUpper,
      isValid: true,
    };
  }

  /**
   * Get configured percentages
   */
  getConfig() {
    return {
      bPricePercent: this.bPricePercent,
      tPricePercent: this.tPricePercent,
      multiplier: this.multiplier,
    };
  }
}
