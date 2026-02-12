/**
 * Price Impact Check
 * Validates that price impact of trades is within acceptable limits
 */

import BN from "bn.js";
import BigNumber from "bignumber.js";
import { Percent, BPS } from "../utils/sdkTypes";
import { PriceProvider } from "../entities";
import { convertAmountToDecimalAmount, getToken } from "../utils/tokenHelper";
import { getLogger } from "../utils/Logger";

const logger = getLogger(module);

/**
 * Price impact check result
 */
export interface PriceImpactResult {
  passed: boolean;
  priceImpact: Percent;
  maxPriceImpact: Percent;
  reason?: string;
}

/**
 * PriceImpactCheck class
 * Validates price impact for swaps to prevent unfavorable trades
 */
export class PriceImpactCheck {
  private maxPriceImpact: Percent;
  private priceProvider: PriceProvider;

  constructor(maxPriceImpact: Percent, priceProvider: PriceProvider) {
    this.maxPriceImpact = maxPriceImpact;
    this.priceProvider = priceProvider;
    logger.info(`PriceImpactCheck: Initialized with max ${maxPriceImpact.toFixed(2)}%`);
  }

  /**
   * Check price impact of a swap
   * Price impact = (value_out - value_in) / value_in
   * 
   * @param tokenInType - Input token type
   * @param tokenOutType - Output token type
   * @param amountIn - Input amount
   * @param amountOut - Output amount
   * @returns Price impact check result
   */
  async checkPriceImpact(
    tokenInType: string,
    tokenOutType: string,
    amountIn: BN,
    amountOut: BN
  ): Promise<PriceImpactResult> {
    logger.info(
      `PriceImpactCheck: Checking price impact - ` +
        `In: ${amountIn.toString()}, Out: ${amountOut.toString()}`
    );

    try {
      // Get token metadata
      const [tokenIn, tokenOut] = await Promise.all([
        getToken(tokenInType),
        getToken(tokenOutType),
      ]);

      // Get USD prices
      const [tokenInPriceUSD, tokenOutPriceUSD] = await Promise.all([
        this.priceProvider.getPrice(tokenInType),
        this.priceProvider.getPrice(tokenOutType),
      ]);

      // Calculate USD values
      const amountInUSD = new BigNumber(
        convertAmountToDecimalAmount(amountIn, tokenIn.decimals)
      ).multipliedBy(tokenInPriceUSD);

      const amountOutUSD = new BigNumber(
        convertAmountToDecimalAmount(amountOut, tokenOut.decimals)
      ).multipliedBy(tokenOutPriceUSD);

      logger.info(
        `PriceImpactCheck: Values - In: $${amountInUSD.toFixed(2)}, Out: $${amountOutUSD.toFixed(2)}`
      );

      // Calculate price impact percentage
      // Price impact = (out - in) / in * 100
      const priceImpactBn = amountOutUSD
        .minus(amountInUSD)
        .multipliedBy(BPS.toString())
        .dividedBy(amountInUSD)
        .toFixed(0);

      const priceImpact = new Percent(priceImpactBn, BPS);

      logger.info(
        `PriceImpactCheck: Price impact: ${priceImpact.toFixed(2)}%, Max: ${this.maxPriceImpact.toFixed(2)}%`
      );

      // Check if within limits
      // Note: Price impact can be negative (loss) or positive (gain)
      // We check if negative impact exceeds threshold
      if (priceImpact.lt(this.maxPriceImpact)) {
        // Negative impact exceeds threshold
        logger.warn(
          `PriceImpactCheck: FAILED - Price impact ${priceImpact.toFixed(2)}% exceeds max ${this.maxPriceImpact.toFixed(2)}%`
        );
        return {
          passed: false,
          priceImpact,
          maxPriceImpact: this.maxPriceImpact,
          reason: `Price impact ${priceImpact.toFixed(2)}% exceeds limit ${this.maxPriceImpact.toFixed(2)}%`,
        };
      }

      logger.info("PriceImpactCheck: PASSED");
      return {
        passed: true,
        priceImpact,
        maxPriceImpact: this.maxPriceImpact,
      };
    } catch (error) {
      logger.error("PriceImpactCheck: Error checking price impact", error);
      // Fail safe - reject on error
      return {
        passed: false,
        priceImpact: new Percent(new BN(0), BPS),
        maxPriceImpact: this.maxPriceImpact,
        reason: `Price impact check failed: ${error.message}`,
      };
    }
  }

  /**
   * Get maximum acceptable price impact
   */
  getMaxPriceImpact(): Percent {
    return this.maxPriceImpact;
  }

  /**
   * Update maximum acceptable price impact
   */
  setMaxPriceImpact(maxPriceImpact: Percent): void {
    this.maxPriceImpact = maxPriceImpact;
    logger.info(`PriceImpactCheck: Max price impact updated to ${maxPriceImpact.toFixed(2)}%`);
  }
}
