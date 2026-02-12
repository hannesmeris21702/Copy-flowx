const Q64 = BigInt(2) ** BigInt(64);
const Q96 = BigInt(2) ** BigInt(96);

export function tickToSqrtPrice(tick: number): bigint {
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

export function sqrtPriceToTick(sqrtPrice: bigint): number {
  // More accurate conversion using logarithm
  // tick = floor(log(sqrtPrice / Q96) / log(sqrt(1.0001)))
  // This is equivalent to: floor(log(sqrtPrice / Q96) / (0.5 * log(1.0001)))
  
  const sqrtPriceNum = Number(sqrtPrice);
  const q96Num = Number(Q96);
  
  if (sqrtPriceNum <= 0 || q96Num <= 0) {
    throw new Error('Invalid sqrt price');
  }
  
  const ratio = sqrtPriceNum / q96Num;
  const logRatio = Math.log(ratio);
  const logSqrtBase = Math.log(Math.sqrt(1.0001));
  
  return Math.floor(logRatio / logSqrtBase);
}

export function getAmountAFromLiquidity(
  sqrtPriceLower: bigint,
  sqrtPriceUpper: bigint,
  liquidity: bigint
): bigint {
  if (sqrtPriceLower > sqrtPriceUpper) {
    [sqrtPriceLower, sqrtPriceUpper] = [sqrtPriceUpper, sqrtPriceLower];
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
  return Math.round(tick / tickSpacing) * tickSpacing;
}

export function calculateTickRange(
  currentTick: number,
  rangeWidthPercent: number,
  tickSpacing: number
): { tickLower: number; tickUpper: number } {
  // Calculate tick range based on price percentage, not tick value
  // For a given percentage p, the tick difference is: log(1 + p/100) / log(1.0001)
  // This ensures the range represents the actual price percentage
  
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
  
  if (currentTick < tickLower) {
    // Calculate deviation as percentage of range width
    const rangeWidth = tickUpper - tickLower;
    if (rangeWidth === 0) return 100; // Degenerate case
    return ((tickLower - currentTick) / rangeWidth) * 100;
  }
  
  // currentTick > tickUpper
  const rangeWidth = tickUpper - tickLower;
  if (rangeWidth === 0) return 100; // Degenerate case
  return ((currentTick - tickUpper) / rangeWidth) * 100;
}
