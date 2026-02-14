const Q64 = BigInt(2) ** BigInt(64);
const Q96 = BigInt(2) ** BigInt(96);

// Tick math constants (same as Uniswap V3 / Cetus)
const MIN_TICK = -443636;
const MAX_TICK = 443636;

export function tickToSqrtPrice(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick ${tick} out of bounds [${MIN_TICK}, ${MAX_TICK}]`);
  }
  
  const absTick = Math.abs(tick);
  
  let ratio = absTick & 0x1 ? BigInt('0xfffcb933bd6fad37aa2d162d1a594001') : Q96;
  
  if (absTick & 0x2) ratio = (ratio * BigInt('0xfff97272373d413259a46990580e213a')) / Q96;
  if (absTick & 0x4) ratio = (ratio * BigInt('0xfff2e50f5f656932ef12357cf3c7fdcc')) / Q96;
  if (absTick & 0x8) ratio = (ratio * BigInt('0xffe5caca7e10e4e61c3624eaa0941cd0')) / Q96;
  if (absTick & 0x10) ratio = (ratio * BigInt('0xffcb9843d60f6159c9db58835c926644')) / Q96;
  if (absTick & 0x20) ratio = (ratio * BigInt('0xff973b41fa98c081472e6896dfb254c0')) / Q96;
  if (absTick & 0x40) ratio = (ratio * BigInt('0xff2ea16466c96a3843ec78b326b52861')) / Q96;
  if (absTick & 0x80) ratio = (ratio * BigInt('0xfe5dee046a99a2a811c461f1969c3053')) / Q96;
  if (absTick & 0x100) ratio = (ratio * BigInt('0xfcbe86c7900a88aedcffc83b479aa3a4')) / Q96;
  if (absTick & 0x200) ratio = (ratio * BigInt('0xf987a7253ac413176f2b074cf7815e54')) / Q96;
  if (absTick & 0x400) ratio = (ratio * BigInt('0xf3392b0822b70005940c7a398e4b70f3')) / Q96;
  if (absTick & 0x800) ratio = (ratio * BigInt('0xe7159475a2c29b7443b29c7fa6e889d9')) / Q96;
  if (absTick & 0x1000) ratio = (ratio * BigInt('0xd097f3bdfd2022b8845ad8f792aa5825')) / Q96;
  if (absTick & 0x2000) ratio = (ratio * BigInt('0xa9f746462d870fdf8a65dc1f90e061e5')) / Q96;
  if (absTick & 0x4000) ratio = (ratio * BigInt('0x70d869a156d2a1b890bb3df62baf32f7')) / Q96;
  if (absTick & 0x8000) ratio = (ratio * BigInt('0x31be135f97d08fd981231505542fcfa6')) / Q96;
  if (absTick & 0x10000) ratio = (ratio * BigInt('0x9aa508b5b7a84e1c677de54f3e99bc9')) / Q96;
  if (absTick & 0x20000) ratio = (ratio * BigInt('0x5d6af8dedb81196699c329225ee604')) / Q96;
  if (absTick & 0x40000) ratio = (ratio * BigInt('0x2216e584f5fa1ea926041bedfe98')) / Q96;
  if (absTick & 0x80000) ratio = (ratio * BigInt('0x48a170391f7dc42444e8fa2')) / Q96;
  
  if (tick > 0) ratio = ((BigInt(2) ** BigInt(192)) - BigInt(1)) / ratio;
  
  return ratio;
}

export function getAmountAFromLiquidity(
  sqrtPriceLower: bigint,
  sqrtPriceUpper: bigint,
  liquidity: bigint
): bigint {
  if (sqrtPriceLower > sqrtPriceUpper) {
    [sqrtPriceLower, sqrtPriceUpper] = [sqrtPriceUpper, sqrtPriceLower];
  }
  
  if (sqrtPriceLower === BigInt(0) || sqrtPriceUpper === BigInt(0)) {
    throw new Error('Invalid sqrt price: cannot be zero');
  }
  
  const numerator = liquidity * (sqrtPriceUpper - sqrtPriceLower) * Q64;
  const denominator = sqrtPriceLower * sqrtPriceUpper;
  
  return numerator / denominator;
}

export function getAmountBFromLiquidity(
  sqrtPriceLower: bigint,
  sqrtPriceUpper: bigint,
  liquidity: bigint
): bigint {
  if (sqrtPriceLower > sqrtPriceUpper) {
    [sqrtPriceLower, sqrtPriceUpper] = [sqrtPriceUpper, sqrtPriceLower];
  }
  
  return (liquidity * (sqrtPriceUpper - sqrtPriceLower)) / Q64;
}

export function alignTickToSpacing(tick: number, tickSpacing: number): number {
  if (tickSpacing <= 0) {
    throw new Error('Tick spacing must be positive');
  }
  return Math.round(tick / tickSpacing) * tickSpacing;
}

export function calculateTickRange(
  currentTick: number,
  rangeWidthPercent: number,
  tickSpacing: number
): { tickLower: number; tickUpper: number } {
  if (rangeWidthPercent <= 0 || rangeWidthPercent > 100) {
    throw new Error('Range width percent must be between 0 and 100');
  }
  
  if (tickSpacing <= 0) {
    throw new Error('Tick spacing must be positive');
  }
  
  // Calculate tick range based on price percentage
  // For a given percentage p, the tick difference is: log(1 + p/100) / log(1.0001)
  const priceRatio = 1 + rangeWidthPercent / 100;
  const tickDelta = Math.floor(Math.log(priceRatio) / Math.log(1.0001));
  
  const tickLower = alignTickToSpacing(
    currentTick - Math.floor(tickDelta / 2),
    tickSpacing
  );
  const tickUpper = alignTickToSpacing(
    currentTick + Math.floor(tickDelta / 2),
    tickSpacing
  );
  
  // Validate bounds
  if (tickLower < MIN_TICK || tickUpper > MAX_TICK) {
    throw new Error(`Calculated tick range [${tickLower}, ${tickUpper}] exceeds bounds`);
  }
  
  return { tickLower, tickUpper };
}

export function isTickInRange(
  currentTick: number,
  tickLower: number,
  tickUpper: number
): boolean {
  return currentTick >= tickLower && currentTick <= tickUpper;
}

export function calculatePriceDeviation(
  currentTick: number,
  tickLower: number,
  tickUpper: number
): number {
  if (currentTick >= tickLower && currentTick <= tickUpper) {
    return 0;
  }
  
  const rangeWidth = tickUpper - tickLower;
  if (rangeWidth === 0) return 100;
  
  if (currentTick < tickLower) {
    return ((tickLower - currentTick) / rangeWidth) * 100;
  }
  
  return ((currentTick - tickUpper) / rangeWidth) * 100;
}

/**
 * Convert sqrt price (X96 format) to actual price
 * Price = (sqrtPrice / 2^96)^2
 * This gives the price of tokenA in terms of tokenB (i.e., how much tokenB per 1 tokenA)
 * 
 * @param sqrtPriceX96 The sqrt price in X96 format
 * @returns The actual price as a number (tokenB/tokenA)
 */
export function sqrtPriceToPrice(sqrtPriceX96: bigint): number {
  // sqrtPrice is in Q96 format (multiplied by 2^96)
  // Price = (sqrtPrice / 2^96)^2
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
  return sqrtPrice * sqrtPrice;
}

/**
 * Calculate the value of token amounts in terms of the quote token (tokenB)
 * 
 * @param amountA Amount of tokenA
 * @param amountB Amount of tokenB
 * @param sqrtPriceX96 Current sqrt price from pool
 * @returns Object with valueA (in terms of B), valueB, and totalValue
 */
export function calculateQuoteValue(
  amountA: bigint,
  amountB: bigint,
  sqrtPriceX96: bigint
): { valueA: number; valueB: number; totalValue: number } {
  // Get the price (tokenB per tokenA)
  const price = sqrtPriceToPrice(sqrtPriceX96);
  
  // Convert amounts to numbers for calculation
  const amountANum = Number(amountA);
  const amountBNum = Number(amountB);
  
  // Calculate value of A in terms of B
  const valueA = amountANum * price;
  
  // Value of B is just the amount of B
  const valueB = amountBNum;
  
  // Total value in terms of B
  const totalValue = valueA + valueB;
  
  return { valueA, valueB, totalValue };
}
