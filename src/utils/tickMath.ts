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

/**
 * Calculate optimal token ratio for a given price range
 * This determines the ideal tokenA/tokenB ratio needed to provide liquidity at current price
 * 
 * @param currentSqrtPrice Current sqrt price from pool
 * @param tickLower Lower tick of the range
 * @param tickUpper Upper tick of the range
 * @returns Optimal ratio as amountA/amountB (or Infinity if only A needed, 0 if only B needed)
 */
export function calculateOptimalRatio(
  currentSqrtPrice: bigint,
  tickLower: number,
  tickUpper: number
): number {
  const sqrtPriceLower = tickToSqrtPrice(tickLower);
  const sqrtPriceUpper = tickToSqrtPrice(tickUpper);
  
  // If current price is below range, only tokenA is needed
  if (currentSqrtPrice <= sqrtPriceLower) {
    return Infinity;
  }
  
  // If current price is above range, only tokenB is needed
  if (currentSqrtPrice >= sqrtPriceUpper) {
    return 0;
  }
  
  // Current price is in range - need both tokens
  // For a unit of liquidity, calculate required amounts
  const liquidity = BigInt(1e18); // Use a large unit for precision
  
  const amountA = getAmountAFromLiquidity(currentSqrtPrice, sqrtPriceUpper, liquidity);
  const amountB = getAmountBFromLiquidity(sqrtPriceLower, currentSqrtPrice, liquidity);
  
  if (amountB === BigInt(0)) {
    return Infinity;
  }
  
  // Return ratio as amountA / amountB
  return Number(amountA) / Number(amountB);
}

/**
 * Check if swap is required based on ratio mismatch
 * 
 * @param availableA Amount of tokenA available
 * @param availableB Amount of tokenB available
 * @param currentSqrtPrice Current sqrt price from pool
 * @param tickLower Lower tick of new range
 * @param tickUpper Upper tick of new range
 * @param tolerancePercent Tolerance for ratio mismatch (default 5%)
 * @returns Object with swapRequired flag and details
 */
export function checkSwapRequired(
  availableA: bigint,
  availableB: bigint,
  currentSqrtPrice: bigint,
  tickLower: number,
  tickUpper: number,
  tolerancePercent: number = 5
): {
  swapRequired: boolean;
  optimalRatio: number;
  availableRatio: number;
  ratioMismatchPercent: number;
  reason: string;
} {
  // Calculate optimal ratio for the new range
  const optimalRatio = calculateOptimalRatio(currentSqrtPrice, tickLower, tickUpper);
  
  // Calculate available ratio
  let availableRatio: number;
  if (availableB === BigInt(0)) {
    availableRatio = Infinity;
  } else {
    availableRatio = Number(availableA) / Number(availableB);
  }
  
  // Handle special cases
  if (optimalRatio === Infinity && availableRatio === Infinity) {
    // Both infinite (only A needed, only A available) - no swap needed
    return {
      swapRequired: false,
      optimalRatio,
      availableRatio,
      ratioMismatchPercent: 0,
      reason: 'Only tokenA needed and available',
    };
  }
  
  if (optimalRatio === 0 && availableB > BigInt(0) && availableA === BigInt(0)) {
    // Only B needed, only B available - no swap needed
    return {
      swapRequired: false,
      optimalRatio,
      availableRatio: 0,
      ratioMismatchPercent: 0,
      reason: 'Only tokenB needed and available',
    };
  }
  
  if (optimalRatio === Infinity || availableRatio === Infinity) {
    // One is infinite but not both - swap needed
    return {
      swapRequired: true,
      optimalRatio,
      availableRatio,
      ratioMismatchPercent: 100,
      reason: 'Ratio mismatch: one token exclusively needed but both available',
    };
  }
  
  // Calculate ratio mismatch percentage
  // Use relative difference: |optimal - available| / optimal * 100
  let ratioMismatchPercent: number;
  if (optimalRatio === 0) {
    ratioMismatchPercent = availableRatio > 0 ? 100 : 0;
  } else {
    ratioMismatchPercent = Math.abs(optimalRatio - availableRatio) / optimalRatio * 100;
  }
  
  const swapRequired = ratioMismatchPercent > tolerancePercent;
  
  const reason = swapRequired
    ? `Ratio mismatch ${ratioMismatchPercent.toFixed(2)}% exceeds tolerance ${tolerancePercent}%`
    : `Ratio mismatch ${ratioMismatchPercent.toFixed(2)}% within tolerance ${tolerancePercent}%`;
  
  return {
    swapRequired,
    optimalRatio,
    availableRatio,
    ratioMismatchPercent,
    reason,
  };
}

/**
 * Calculate swap amount needed to achieve optimal ratio
 * 
 * @param availableA Amount of tokenA available
 * @param availableB Amount of tokenB available
 * @param optimalRatio Target ratio (amountA / amountB)
 * @param currentPrice Current price (tokenB per tokenA)
 * @returns Swap details including amount and direction
 */
export function calculateSwapAmount(
  availableA: bigint,
  availableB: bigint,
  optimalRatio: number,
  currentPrice: number
): {
  swapFromA: boolean;
  swapAmount: bigint;
  expectedOutput: bigint;
} | null {
  // Handle special cases
  if (optimalRatio === Infinity) {
    // Need only A, swap all B to A
    if (availableB > BigInt(0)) {
      return {
        swapFromA: false,
        swapAmount: availableB,
        expectedOutput: BigInt(Math.floor(Number(availableB) / currentPrice)),
      };
    }
    return null;
  }
  
  if (optimalRatio === 0) {
    // Need only B, swap all A to B
    if (availableA > BigInt(0)) {
      return {
        swapFromA: true,
        swapAmount: availableA,
        expectedOutput: BigInt(Math.floor(Number(availableA) * currentPrice)),
      };
    }
    return null;
  }
  
  // Calculate current and target values
  const availableANum = Number(availableA);
  const availableBNum = Number(availableB);
  const currentRatio = availableANum / availableBNum;
  
  // If we need more A (current ratio < optimal ratio)
  if (currentRatio < optimalRatio) {
    // Swap some B to A
    // After swap: (availableA + deltaA) / (availableB - deltaB) = optimalRatio
    // Where deltaA = deltaB / price
    // Solving: availableA + deltaB/price = optimalRatio * (availableB - deltaB)
    // availableA + deltaB/price = optimalRatio * availableB - optimalRatio * deltaB
    // deltaB/price + optimalRatio * deltaB = optimalRatio * availableB - availableA
    // deltaB * (1/price + optimalRatio) = optimalRatio * availableB - availableA
    // deltaB = (optimalRatio * availableB - availableA) / (1/price + optimalRatio)
    
    const deltaBNum = (optimalRatio * availableBNum - availableANum) / (1 / currentPrice + optimalRatio);
    
    if (deltaBNum <= 0 || deltaBNum > availableBNum) {
      return null;
    }
    
    const swapAmount = BigInt(Math.floor(deltaBNum));
    const expectedOutput = BigInt(Math.floor(deltaBNum / currentPrice));
    
    return {
      swapFromA: false,
      swapAmount,
      expectedOutput,
    };
  } else {
    // Swap some A to B
    // After swap: (availableA - deltaA) / (availableB + deltaB) = optimalRatio
    // Where deltaB = deltaA * price
    // Solving: availableA - deltaA = optimalRatio * (availableB + deltaA * price)
    // availableA - deltaA = optimalRatio * availableB + optimalRatio * price * deltaA
    // availableA - optimalRatio * availableB = deltaA + optimalRatio * price * deltaA
    // availableA - optimalRatio * availableB = deltaA * (1 + optimalRatio * price)
    // deltaA = (availableA - optimalRatio * availableB) / (1 + optimalRatio * price)
    
    const deltaANum = (availableANum - optimalRatio * availableBNum) / (1 + optimalRatio * currentPrice);
    
    if (deltaANum <= 0 || deltaANum > availableANum) {
      return null;
    }
    
    const swapAmount = BigInt(Math.floor(deltaANum));
    const expectedOutput = BigInt(Math.floor(deltaANum * currentPrice));
    
    return {
      swapFromA: true,
      swapAmount,
      expectedOutput,
    };
  }
}

/**
 * Calculate optimal liquidity amounts for a position
 * Ensures amounts don't exceed available balances
 * 
 * @param availableA Available amount of token A in wallet
 * @param availableB Available amount of token B in wallet
 * @param currentSqrtPrice Current sqrt price of the pool
 * @param tickLower Lower tick of the position
 * @param tickUpper Upper tick of the position
 * @returns Amounts of A and B to add as liquidity
 */
export function calculateLiquidityAmounts(
  availableA: bigint,
  availableB: bigint,
  currentSqrtPrice: bigint,
  tickLower: number,
  tickUpper: number
): { amountA: bigint; amountB: bigint } {
  const sqrtPriceLower = tickToSqrtPrice(tickLower);
  const sqrtPriceUpper = tickToSqrtPrice(tickUpper);
  
  // Determine current price position relative to the range
  // If price is below range, only token A is needed
  if (currentSqrtPrice < sqrtPriceLower) {
    return {
      amountA: availableA,
      amountB: BigInt(0),
    };
  }
  
  // If price is above range, only token B is needed
  if (currentSqrtPrice > sqrtPriceUpper) {
    return {
      amountA: BigInt(0),
      amountB: availableB,
    };
  }
  
  // Price is in range, need both tokens in specific ratio
  // Calculate the optimal ratio for this range at current price
  const optimalRatio = calculateOptimalRatio(currentSqrtPrice, tickLower, tickUpper);
  
  // Convert to numbers for calculation
  const availableANum = Number(availableA);
  const availableBNum = Number(availableB);
  
  // Calculate how much we can use based on the optimal ratio
  // Try to use maximum liquidity possible
  
  // Option 1: Use all of token A
  const neededBForAllA = availableANum / optimalRatio;
  if (neededBForAllA <= availableBNum) {
    // We have enough B, use all A
    return {
      amountA: availableA,
      amountB: BigInt(Math.floor(neededBForAllA)),
    };
  }
  
  // Option 2: Use all of token B
  const neededAForAllB = availableBNum * optimalRatio;
  if (neededAForAllB <= availableANum) {
    // We have enough A, use all B
    return {
      amountA: BigInt(Math.floor(neededAForAllB)),
      amountB: availableB,
    };
  }
  
  // This should not be reached under normal circumstances
  // If we get here, it means the ratio calculations above had rounding issues
  // As a safe fallback, use all available tokens
  // This may result in slightly more dust than optimal
  return {
    amountA: availableA,
    amountB: availableB,
  };
}
