/**
 * Slippage Check
 * Validates that slippage is within acceptable limits for trades
 */

import BN from "bn.js";
import { Percent, BPS } from "../utils/sdkTypes";
import { getLogger } from "../utils/Logger";

const logger = getLogger(module);

/**
 * Slippage check result
 */
export interface SlippageCheckResult {
  passed: boolean;
  actualSlippage: Percent;
  maxSlippage: Percent;
  reason?: string;
}

/**
 * SlippageCheck class
 * Validates slippage for swaps and liquidity operations
 */
export class SlippageCheck {
  private maxSlippage: Percent;

  constructor(maxSlippage: Percent) {
    this.maxSlippage = maxSlippage;
    logger.info(`SlippageCheck: Initialized with max ${maxSlippage.toFixed(2)}%`);
  }

  /**
   * Check if actual output is within slippage tolerance
   * 
   * @param expectedOut - Expected output amount
   * @param actualOut - Actual output amount
   * @returns Slippage check result
   */
  checkSlippage(expectedOut: BN, actualOut: BN): SlippageCheckResult {
    logger.info(
      `SlippageCheck: Checking slippage - Expected: ${expectedOut.toString()}, Actual: ${actualOut.toString()}`
    );

    // Calculate slippage percentage
    // Slippage = (expected - actual) / expected
    const difference = expectedOut.sub(actualOut);
    
    // Handle case where actual > expected (positive slippage)
    if (actualOut.gte(expectedOut)) {
      logger.info("SlippageCheck: PASSED - Actual output exceeds expected (positive slippage)");
      return {
        passed: true,
        actualSlippage: new Percent(new BN(0), BPS),
        maxSlippage: this.maxSlippage,
      };
    }

    // Calculate slippage as percentage
    const slippageBps = difference.mul(BPS).div(expectedOut);
    const actualSlippage = new Percent(slippageBps, BPS);

    logger.info(
      `SlippageCheck: Actual slippage: ${actualSlippage.toFixed(2)}%, Max: ${this.maxSlippage.toFixed(2)}%`
    );

    // Check if within tolerance
    if (actualSlippage.lt(this.maxSlippage) || actualSlippage.numerator.eq(this.maxSlippage.numerator)) {
      logger.info("SlippageCheck: PASSED");
      return {
        passed: true,
        actualSlippage,
        maxSlippage: this.maxSlippage,
      };
    } else {
      logger.warn(
        `SlippageCheck: FAILED - Slippage ${actualSlippage.toFixed(2)}% exceeds max ${this.maxSlippage.toFixed(2)}%`
      );
      return {
        passed: false,
        actualSlippage,
        maxSlippage: this.maxSlippage,
        reason: `Slippage ${actualSlippage.toFixed(2)}% exceeds limit ${this.maxSlippage.toFixed(2)}%`,
      };
    }
  }

  /**
   * Calculate minimum acceptable output given expected output
   * 
   * @param expectedOut - Expected output amount
   * @returns Minimum acceptable output
   */
  calculateMinOutput(expectedOut: BN): BN {
    // Min out = expected * (1 - slippage)
    const slippageFactor = BPS.sub(this.maxSlippage.numerator);
    const minOut = expectedOut.mul(slippageFactor).div(BPS);

    logger.info(
      `SlippageCheck: Min output for expected ${expectedOut.toString()} = ${minOut.toString()}`
    );

    return minOut;
  }

  /**
   * Get maximum slippage tolerance
   */
  getMaxSlippage(): Percent {
    return this.maxSlippage;
  }

  /**
   * Update maximum slippage tolerance
   */
  setMaxSlippage(maxSlippage: Percent): void {
    this.maxSlippage = maxSlippage;
    logger.info(`SlippageCheck: Max slippage updated to ${maxSlippage.toFixed(2)}%`);
  }
}
