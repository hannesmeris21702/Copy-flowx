import BN from "bn.js";
import Decimal from "decimal.js";

/**
 * TickMath utility for converting between ticks and sqrtPriceX64
 * Based on CLMM math: price = 1.0001^tick
 * sqrtPriceX64 = sqrt(price) * 2^64
 */

const Q64 = new BN(2).pow(new BN(64));
const Q128 = new BN(2).pow(new BN(128));
const MIN_TICK = -443636;
const MAX_TICK = 443636;

/**
 * Convert tick index to sqrtPriceX64
 * @param tick - Tick index
 * @returns sqrtPriceX64 as BN
 */
export function tickIndexToSqrtPriceX64(tick: number): BN {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick ${tick} is out of bounds [${MIN_TICK}, ${MAX_TICK}]`);
  }

  // Calculate price = 1.0001^tick
  const price = new Decimal(1.0001).pow(tick);
  
  // Calculate sqrt(price)
  const sqrtPrice = price.sqrt();
  
  // Multiply by 2^64
  const sqrtPriceX64 = sqrtPrice.mul(new Decimal(2).pow(64));
  
  // Convert to BN
  return new BN(sqrtPriceX64.toFixed(0));
}

/**
 * Convert sqrtPriceX64 to tick index
 * @param sqrtPriceX64 - sqrtPriceX64 as BN
 * @returns Approximate tick index
 */
export function sqrtPriceX64ToTickIndex(sqrtPriceX64: BN): number {
  // Divide by 2^64 to get sqrtPrice
  const sqrtPriceDecimal = new Decimal(sqrtPriceX64.toString()).div(
    new Decimal(2).pow(64)
  );
  
  // Square to get price
  const price = sqrtPriceDecimal.pow(2);
  
  // Calculate tick = log(price) / log(1.0001)
  const tick = price.log(1.0001);
  
  // Round to nearest integer
  return Math.round(tick.toNumber());
}

/**
 * Convert sqrtPriceX64 to human-readable price
 * @param sqrtPriceX64 - sqrtPriceX64 as BN or string
 * @param decimalsA - Decimals of token A
 * @param decimalsB - Decimals of token B
 * @returns Price as Decimal
 */
export function sqrtPriceX64ToPrice(
  sqrtPriceX64: BN | string,
  decimalsA: number,
  decimalsB: number
): Decimal {
  const sqrtPriceBN = typeof sqrtPriceX64 === "string" ? new BN(sqrtPriceX64) : sqrtPriceX64;
  
  // Divide by 2^64 to get sqrtPrice
  const sqrtPrice = new Decimal(sqrtPriceBN.toString()).div(
    new Decimal(2).pow(64)
  );
  
  // Square to get price
  const price = sqrtPrice.pow(2);
  
  // Adjust for decimals
  const decimalAdjustment = new Decimal(10).pow(decimalsB - decimalsA);
  
  return price.mul(decimalAdjustment);
}

/**
 * Calculate token A amount for a given liquidity and price range
 * Formula: ΔA = L * (sqrtPriceB - sqrtPriceA) / (sqrtPriceA * sqrtPriceB)
 * 
 * @param sqrtPriceAX64 - Lower sqrt price (as BN)
 * @param sqrtPriceBX64 - Upper sqrt price (as BN)
 * @param liquidity - Liquidity amount (as BN)
 * @param roundUp - Whether to round up
 * @returns Amount of token A
 */
export function getAmountAFromLiquidity(
  sqrtPriceAX64: BN,
  sqrtPriceBX64: BN,
  liquidity: BN,
  roundUp: boolean
): BN {
  if (sqrtPriceAX64.gt(sqrtPriceBX64)) {
    [sqrtPriceAX64, sqrtPriceBX64] = [sqrtPriceBX64, sqrtPriceAX64];
  }

  const numerator = liquidity.mul(sqrtPriceBX64.sub(sqrtPriceAX64)).mul(Q64);
  const denominator = sqrtPriceBX64.mul(sqrtPriceAX64);

  if (roundUp) {
    return numerator.add(denominator).sub(new BN(1)).div(denominator);
  } else {
    return numerator.div(denominator);
  }
}

/**
 * Calculate token B amount for a given liquidity and price range
 * Formula: ΔB = L * (sqrtPriceB - sqrtPriceA)
 * 
 * @param sqrtPriceAX64 - Lower sqrt price (as BN)
 * @param sqrtPriceBX64 - Upper sqrt price (as BN)
 * @param liquidity - Liquidity amount (as BN)
 * @param roundUp - Whether to round up
 * @returns Amount of token B
 */
export function getAmountBFromLiquidity(
  sqrtPriceAX64: BN,
  sqrtPriceBX64: BN,
  liquidity: BN,
  roundUp: boolean
): BN {
  if (sqrtPriceAX64.gt(sqrtPriceBX64)) {
    [sqrtPriceAX64, sqrtPriceBX64] = [sqrtPriceBX64, sqrtPriceAX64];
  }

  const diff = sqrtPriceBX64.sub(sqrtPriceAX64);
  const amount = liquidity.mul(diff).div(Q64);

  if (roundUp) {
    return amount.add(new BN(1));
  } else {
    return amount;
  }
}

/**
 * Get token amounts from liquidity for a position
 * @param sqrtPriceCurrentX64 - Current pool sqrt price
 * @param sqrtPriceLowerX64 - Position lower bound sqrt price
 * @param sqrtPriceUpperX64 - Position upper bound sqrt price
 * @param liquidity - Position liquidity
 * @param roundUp - Whether to round up
 * @returns Object with amountA and amountB
 */
export function getAmountsFromLiquidity(
  sqrtPriceCurrentX64: BN,
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  liquidity: BN,
  roundUp: boolean
): { amountA: BN; amountB: BN } {
  let amountA = new BN(0);
  let amountB = new BN(0);

  if (sqrtPriceCurrentX64.lte(sqrtPriceLowerX64)) {
    // Current price is below the range - only token A
    amountA = getAmountAFromLiquidity(sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, roundUp);
  } else if (sqrtPriceCurrentX64.lt(sqrtPriceUpperX64)) {
    // Current price is in range - both tokens
    amountA = getAmountAFromLiquidity(sqrtPriceCurrentX64, sqrtPriceUpperX64, liquidity, roundUp);
    amountB = getAmountBFromLiquidity(sqrtPriceLowerX64, sqrtPriceCurrentX64, liquidity, roundUp);
  } else {
    // Current price is above the range - only token B
    amountB = getAmountBFromLiquidity(sqrtPriceLowerX64, sqrtPriceUpperX64, liquidity, roundUp);
  }

  return { amountA, amountB };
}

/**
 * Calculate liquidity from token A amount
 * Formula: L = ΔA * sqrtPriceA * sqrtPriceB / (sqrtPriceB - sqrtPriceA)
 * 
 * @param sqrtPriceAX64 - Lower sqrt price
 * @param sqrtPriceBX64 - Upper sqrt price
 * @param amountA - Amount of token A
 * @returns Liquidity
 */
export function getLiquidityFromAmountA(
  sqrtPriceAX64: BN,
  sqrtPriceBX64: BN,
  amountA: BN
): BN {
  if (sqrtPriceAX64.gt(sqrtPriceBX64)) {
    [sqrtPriceAX64, sqrtPriceBX64] = [sqrtPriceBX64, sqrtPriceAX64];
  }

  const numerator = amountA.mul(sqrtPriceAX64).mul(sqrtPriceBX64).div(Q64);
  const denominator = sqrtPriceBX64.sub(sqrtPriceAX64);

  return numerator.div(denominator);
}

/**
 * Calculate liquidity from token B amount
 * Formula: L = ΔB / (sqrtPriceB - sqrtPriceA)
 * 
 * @param sqrtPriceAX64 - Lower sqrt price
 * @param sqrtPriceBX64 - Upper sqrt price
 * @param amountB - Amount of token B
 * @returns Liquidity
 */
export function getLiquidityFromAmountB(
  sqrtPriceAX64: BN,
  sqrtPriceBX64: BN,
  amountB: BN
): BN {
  if (sqrtPriceAX64.gt(sqrtPriceBX64)) {
    [sqrtPriceAX64, sqrtPriceBX64] = [sqrtPriceBX64, sqrtPriceAX64];
  }

  const diff = sqrtPriceBX64.sub(sqrtPriceAX64);
  return amountB.mul(Q64).div(diff);
}

/**
 * Get liquidity from token amounts
 * @param sqrtPriceCurrentX64 - Current pool sqrt price
 * @param sqrtPriceLowerX64 - Position lower bound sqrt price
 * @param sqrtPriceUpperX64 - Position upper bound sqrt price
 * @param amountA - Amount of token A
 * @param amountB - Amount of token B
 * @returns Calculated liquidity
 */
export function getLiquidityFromAmounts(
  sqrtPriceCurrentX64: BN,
  sqrtPriceLowerX64: BN,
  sqrtPriceUpperX64: BN,
  amountA: BN,
  amountB: BN
): BN {
  let liquidity: BN;

  if (sqrtPriceCurrentX64.lte(sqrtPriceLowerX64)) {
    // Current price is below the range - use only token A
    liquidity = getLiquidityFromAmountA(sqrtPriceLowerX64, sqrtPriceUpperX64, amountA);
  } else if (sqrtPriceCurrentX64.lt(sqrtPriceUpperX64)) {
    // Current price is in range - use both tokens, take minimum
    const liquidityA = getLiquidityFromAmountA(sqrtPriceCurrentX64, sqrtPriceUpperX64, amountA);
    const liquidityB = getLiquidityFromAmountB(sqrtPriceLowerX64, sqrtPriceCurrentX64, amountB);
    liquidity = liquidityA.lt(liquidityB) ? liquidityA : liquidityB;
  } else {
    // Current price is above the range - use only token B
    liquidity = getLiquidityFromAmountB(sqrtPriceLowerX64, sqrtPriceUpperX64, amountB);
  }

  return liquidity;
}

/**
 * ClmmTickMath namespace for compatibility with existing code
 */
export const ClmmTickMath = {
  tickIndexToSqrtPriceX64,
  sqrtPriceX64ToTickIndex,
  sqrtPriceX64ToPrice,
  getAmountAFromLiquidity,
  getAmountBFromLiquidity,
  getAmountsFromLiquidity,
  getLiquidityFromAmountA,
  getLiquidityFromAmountB,
  getLiquidityFromAmounts,
};
