/**
 * Value Preservation
 * Ensures total USD value is maintained during rebalancing operations
 */

import BN from "bn.js";
import BigNumber from "bignumber.js";
import { Position, PriceProvider } from "../entities";
import { convertAmountToDecimalAmount, getToken } from "../utils/tokenHelper";
import { getLogger } from "../utils/Logger";
import { Percent, BPS } from "../utils/sdkTypes";

const logger = getLogger(module);

/**
 * Position value breakdown
 */
export interface PositionValue {
  tokenXAmount: BN;
  tokenYAmount: BN;
  tokenXValueUsd: BigNumber;
  tokenYValueUsd: BigNumber;
  totalValueUsd: BigNumber;
}

/**
 * Value preservation check result
 */
export interface ValueCheck {
  isWithinTolerance: boolean;
  beforeValueUsd: BigNumber;
  afterValueUsd: BigNumber;
  driftPercent: Percent;
  driftAbsolute: BigNumber;
}

/**
 * ValuePreservation class
 * Calculates and validates that total position value is preserved during operations
 */
export class ValuePreservation {
  private priceProvider: PriceProvider;
  private maxDriftPercent: Percent;

  constructor(priceProvider: PriceProvider, maxDriftPercent: Percent) {
    this.priceProvider = priceProvider;
    this.maxDriftPercent = maxDriftPercent;
    logger.info(
      `ValuePreservation: Initialized with max drift ${maxDriftPercent.toFixed(2)}%`
    );
  }

  /**
   * Calculate total USD value of a position
   * @param position - Position object
   * @returns Position value breakdown
   */
  async calculatePositionValue(position: Position): Promise<PositionValue> {
    logger.info(`ValuePreservation: Calculating value for position ${position.id}`);

    const amounts = position.mintAmounts;
    const tokenXAmount = amounts.amountX;
    const tokenYAmount = amounts.amountY;

    const tokenXType = position.pool.coinX.coinType;
    const tokenYType = position.pool.coinY.coinType;

    // Get token metadata
    const [tokenX, tokenY] = await Promise.all([
      getToken(tokenXType),
      getToken(tokenYType),
    ]);

    // Get USD prices
    const [tokenXPriceUsd, tokenYPriceUsd] = await Promise.all([
      this.priceProvider.getPrice(tokenXType),
      this.priceProvider.getPrice(tokenYType),
    ]);

    // Calculate USD values
    const tokenXValueUsd = new BigNumber(
      convertAmountToDecimalAmount(tokenXAmount, tokenX.decimals)
    ).multipliedBy(tokenXPriceUsd);

    const tokenYValueUsd = new BigNumber(
      convertAmountToDecimalAmount(tokenYAmount, tokenY.decimals)
    ).multipliedBy(tokenYPriceUsd);

    const totalValueUsd = tokenXValueUsd.plus(tokenYValueUsd);

    logger.info(
      `ValuePreservation: Position value - ` +
        `Token X: $${tokenXValueUsd.toFixed(2)}, ` +
        `Token Y: $${tokenYValueUsd.toFixed(2)}, ` +
        `Total: $${totalValueUsd.toFixed(2)}`
    );

    return {
      tokenXAmount,
      tokenYAmount,
      tokenXValueUsd,
      tokenYValueUsd,
      totalValueUsd,
    };
  }

  /**
   * Calculate total USD value from token amounts
   * @param tokenXAmount - Amount of token X
   * @param tokenYAmount - Amount of token Y
   * @param tokenXType - Token X type string
   * @param tokenYType - Token Y type string
   * @returns Total USD value
   */
  async calculateValue(
    tokenXAmount: BN,
    tokenYAmount: BN,
    tokenXType: string,
    tokenYType: string
  ): Promise<BigNumber> {
    // Get token metadata
    const [tokenX, tokenY] = await Promise.all([
      getToken(tokenXType),
      getToken(tokenYType),
    ]);

    // Get USD prices
    const [tokenXPriceUsd, tokenYPriceUsd] = await Promise.all([
      this.priceProvider.getPrice(tokenXType),
      this.priceProvider.getPrice(tokenYType),
    ]);

    // Calculate USD values
    const tokenXValueUsd = new BigNumber(
      convertAmountToDecimalAmount(tokenXAmount, tokenX.decimals)
    ).multipliedBy(tokenXPriceUsd);

    const tokenYValueUsd = new BigNumber(
      convertAmountToDecimalAmount(tokenYAmount, tokenY.decimals)
    ).multipliedBy(tokenYPriceUsd);

    return tokenXValueUsd.plus(tokenYValueUsd);
  }

  /**
   * Check if value drift is within acceptable tolerance
   * @param beforeValueUsd - Value before operation
   * @param afterValueUsd - Value after operation
   * @returns Value check result
   */
  checkValuePreservation(
    beforeValueUsd: BigNumber,
    afterValueUsd: BigNumber
  ): ValueCheck {
    // Calculate absolute drift
    const driftAbsolute = afterValueUsd.minus(beforeValueUsd);

    // Calculate drift percentage
    const driftPercent = new Percent(
      driftAbsolute
        .multipliedBy(BPS.toString())
        .dividedBy(beforeValueUsd)
        .abs()
        .toFixed(0),
      BPS
    );

    // Check if within tolerance
    const isWithinTolerance = driftPercent.lt(this.maxDriftPercent);

    if (isWithinTolerance) {
      logger.info(
        `ValuePreservation: Value preserved - ` +
          `Drift: ${driftPercent.toFixed(2)}% ($${driftAbsolute.toFixed(2)}), ` +
          `Tolerance: ${this.maxDriftPercent.toFixed(2)}%`
      );
    } else {
      logger.warn(
        `ValuePreservation: Value drift EXCEEDS tolerance - ` +
          `Drift: ${driftPercent.toFixed(2)}% ($${driftAbsolute.toFixed(2)}), ` +
          `Tolerance: ${this.maxDriftPercent.toFixed(2)}%`
      );
    }

    return {
      isWithinTolerance,
      beforeValueUsd,
      afterValueUsd,
      driftPercent,
      driftAbsolute,
    };
  }

  /**
   * Get maximum allowed drift percentage
   */
  getMaxDrift(): Percent {
    return this.maxDriftPercent;
  }

  /**
   * Update maximum allowed drift percentage
   */
  setMaxDrift(maxDriftPercent: Percent): void {
    this.maxDriftPercent = maxDriftPercent;
    logger.info(
      `ValuePreservation: Max drift updated to ${maxDriftPercent.toFixed(2)}%`
    );
  }
}
