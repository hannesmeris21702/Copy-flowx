/**
 * Volatility Guard
 * Monitors price volatility and blocks operations during abnormal market conditions
 */

import BN from "bn.js";
import { Percent, BPS } from "../utils/sdkTypes";
import { getLogger } from "../utils/Logger";

const logger = getLogger(module);

/**
 * Price data point for volatility calculation
 */
interface PricePoint {
  price: BN;
  timestamp: number;
}

/**
 * Volatility check result
 */
export interface VolatilityCheckResult {
  safe: boolean;
  volatility: Percent;
  maxVolatility: Percent;
  reason?: string;
}

/**
 * VolatilityGuard class
 * Monitors price volatility and prevents operations during high volatility
 */
export class VolatilityGuard {
  private maxVolatility: Percent;
  private priceHistory: PricePoint[] = [];
  private windowMs: number;
  private maxHistorySize: number = 100;

  constructor(maxVolatility: Percent, windowMs: number = 300000) {
    // Default 5 minute window
    this.maxVolatility = maxVolatility;
    this.windowMs = windowMs;
    logger.info(
      `VolatilityGuard: Initialized with max ${maxVolatility.toFixed(2)}%, ` +
        `window ${Math.floor(windowMs / 1000)}s`
    );
  }

  /**
   * Record a price observation
   * 
   * @param price - Current price (as BN for precision)
   */
  recordPrice(price: BN): void {
    const now = Date.now();

    this.priceHistory.push({
      price,
      timestamp: now,
    });

    // Clean up old prices outside window
    this.cleanupOldPrices(now);

    // Limit history size
    if (this.priceHistory.length > this.maxHistorySize) {
      this.priceHistory = this.priceHistory.slice(-this.maxHistorySize);
    }

    logger.debug(
      `VolatilityGuard: Price recorded - ${price.toString()}, history size: ${this.priceHistory.length}`
    );
  }

  /**
   * Check if current volatility is within acceptable limits
   * 
   * @returns Volatility check result
   */
  checkVolatility(): VolatilityCheckResult {
    logger.info("VolatilityGuard: Checking volatility");

    // Need at least 2 prices to calculate volatility
    if (this.priceHistory.length < 2) {
      logger.info("VolatilityGuard: SAFE - Insufficient price history");
      return {
        safe: true,
        volatility: new Percent(new BN(0), BPS),
        maxVolatility: this.maxVolatility,
        reason: "Insufficient price history",
      };
    }

    // Calculate volatility as % change from min to max in window
    const prices = this.priceHistory.map((p) => p.price);
    let minPrice = prices[0];
    let maxPrice = prices[0];
    
    for (const price of prices) {
      if (price.lt(minPrice)) minPrice = price;
      if (price.gt(maxPrice)) maxPrice = price;
    }

    // Volatility = (max - min) / min * 100%
    const priceRange = maxPrice.sub(minPrice);
    const volatilityBps = priceRange.mul(BPS).div(minPrice);
    const volatility = new Percent(volatilityBps, BPS);

    logger.info(
      `VolatilityGuard: Volatility: ${volatility.toFixed(2)}%, Max: ${this.maxVolatility.toFixed(2)}%`
    );

    // Check if within limits
    if (volatility.lt(this.maxVolatility) || volatility.numerator.eq(this.maxVolatility.numerator)) {
      logger.info("VolatilityGuard: SAFE");
      return {
        safe: true,
        volatility,
        maxVolatility: this.maxVolatility,
      };
    }

    logger.warn(
      `VolatilityGuard: UNSAFE - Volatility ${volatility.toFixed(2)}% exceeds max ${this.maxVolatility.toFixed(2)}%`
    );

    return {
      safe: false,
      volatility,
      maxVolatility: this.maxVolatility,
      reason: `High volatility detected: ${volatility.toFixed(2)}% exceeds limit ${this.maxVolatility.toFixed(2)}%`,
    };
  }

  /**
   * Clean up price history older than window
   */
  private cleanupOldPrices(now: number): void {
    const cutoff = now - this.windowMs;
    this.priceHistory = this.priceHistory.filter((p) => p.timestamp >= cutoff);
  }

  /**
   * Get current volatility percentage
   */
  getCurrentVolatility(): Percent {
    const result = this.checkVolatility();
    return result.volatility;
  }

  /**
   * Get maximum acceptable volatility
   */
  getMaxVolatility(): Percent {
    return this.maxVolatility;
  }

  /**
   * Update maximum acceptable volatility
   */
  setMaxVolatility(maxVolatility: Percent): void {
    this.maxVolatility = maxVolatility;
    logger.info(`VolatilityGuard: Max volatility updated to ${maxVolatility.toFixed(2)}%`);
  }

  /**
   * Clear price history
   */
  reset(): void {
    this.priceHistory = [];
    logger.info("VolatilityGuard: Price history reset");
  }

  /**
   * Get number of price points in history
   */
  getHistorySize(): number {
    return this.priceHistory.length;
  }
}
