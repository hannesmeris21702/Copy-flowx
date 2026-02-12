# CLMM Math & Logic Review

## Executive Summary

Comprehensive review of CLMM (Concentrated Liquidity Market Maker) mathematical operations and logical flows in the SUI liquidity management bot. The core CLMM math is correct, but one medium-severity issue was found and fixed.

## Review Scope

- **Tick Math** (`src/utils/tickMath.ts`) - Core CLMM calculations
- **Range Calculations** (`src/engine/RangeCalculator.ts`) - Position range logic
- **Worker Rebalance Logic** (`src/Worker.ts`) - Main orchestration
- **Position Value Calculations** (`src/entities/position/Position.ts`) - Token amounts
- **Zap Calculator** (`src/utils/zapCalculator.ts`) - Token ratio calculations
- **Pool Helper** (`src/utils/poolHelper.ts`) - Active range determination

## Issues Found & Fixed

### 1. ✅ FIXED: Price Impact Calculation Uses Wrong Denominator (MEDIUM)

**Location**: `src/PositionManager.ts:91-99`

**Issue**: The price impact formula used `amountOut` as the denominator instead of `amountIn`.

**Impact Example**:
- Swap $100 for $95 (5% loss):
  - Incorrect calculation: (95 - 100) / 95 = -5.26%
  - Correct calculation: (95 - 100) / 100 = -5.0%

**Fix Applied**:
```typescript
// Before:
const priceImpact = new Percent(
  amountOutUSD.multipliedBy(BPS).minus(amountInUSD.multipliedBy(BPS)).toFixed(0),
  amountOutUSD.multipliedBy(BPS).toFixed(0)  // Wrong denominator
);

// After:
const priceImpact = new Percent(
  amountOutUSD.multipliedBy(BPS).minus(amountInUSD.multipliedBy(BPS)).toFixed(0),
  amountInUSD.multipliedBy(BPS).toFixed(0)  // Correct denominator
);
```

### 2. ✅ IMPROVED: Tick Spacing Alignment (LOW)

**Location**: `src/Worker.ts:279-281`

**Issue**: After adjusting tick ranges, alignment to `tickSpacing` was not explicitly enforced.

**Fix Applied**: Added defensive validation:
```typescript
// Ensure ticks are properly aligned to tickSpacing (defensive programming)
newLowerTick = Math.round(newLowerTick / pool.tickSpacing) * pool.tickSpacing;
newUpperTick = Math.round(newUpperTick / pool.tickSpacing) * pool.tickSpacing;
```

## Core CLMM Math Verification

All core CLMM formulas have been verified against Uniswap V3 / CLMM standards:

### ✅ tickIndexToSqrtPriceX64
- **Formula**: `sqrtPrice = sqrt(1.0001^tick) * 2^64`
- **Status**: CORRECT
- Uses `Decimal.js` for high precision

### ✅ sqrtPriceX64ToTickIndex
- **Formula**: `tick = log(price) / log(1.0001)`
- **Status**: CORRECT
- Properly inverts the tick-to-price calculation

### ✅ getAmountAFromLiquidity
- **Formula**: `ΔA = L * (sqrtB - sqrtA) * 2^64 / (sqrtA * sqrtB)`
- **Status**: CORRECT
- Handles Q64 fixed-point arithmetic properly

### ✅ getAmountBFromLiquidity
- **Formula**: `ΔB = L * (sqrtB - sqrtA) / 2^64`
- **Status**: CORRECT

### ✅ getLiquidityFromAmountA
- **Formula**: `L = ΔA * sqrtA * sqrtB / ((sqrtB - sqrtA) * 2^64)`
- **Status**: CORRECT

### ✅ getLiquidityFromAmountB
- **Formula**: `L = ΔB * 2^64 / (sqrtB - sqrtA)`
- **Status**: CORRECT

### ✅ getAmountsFromLiquidity
- **Logic**: Correctly handles 3 cases:
  1. Price below range → Only token A
  2. Price in range → Both tokens
  3. Price above range → Only token B
- **Status**: CORRECT

### ✅ getLiquidityFromAmounts
- **Logic**: Takes minimum of liquidity from both tokens when in range
- **Status**: CORRECT

## Edge Cases Reviewed

### 1. ✅ Division by Zero Protection
- Protected by position validation in `Worker.ts:202`
- Invalid tick ranges (where `tickLower >= tickUpper`) are rejected early

### 2. ✅ Price at Boundary Handling
- When price equals lower bound: Only token A (correct)
- When price equals upper bound: Only token B (correct)
- Follows CLMM standard behavior

### 3. ✅ Tick Alignment
- `closestActiveRange` ensures proper alignment via `Math.round`
- Now also validated after adjustments in Worker

### 4. ✅ Overflow Protection
- All operations use `bn.js` BigNum library
- No overflow issues detected

## Position Logic Verification

### ✅ In-Range Check (Worker.ts:224)
```typescript
const isInRange = currentTick >= tickLower && currentTick <= tickUpper;
```
- Uses inclusive boundaries on both ends
- Correct per CLMM semantics

### ✅ Rebalance Trigger (Worker.ts:230-233)
```typescript
if (isInRange) {
  this.logger.info("Position is in range, no rebalance needed");
  return;
}
```
- Never rebalances when in range (safety rule)
- Correct behavior

### ✅ New Range Validation (Worker.ts:284-298)
- Validates `newLowerTick < newUpperTick`
- Validates new range contains current tick
- Correct safety checks

## Test Coverage

Existing tests in `src/utils/tickMath.spec.ts` cover:
- ✅ Tick to sqrtPrice conversions
- ✅ Round-trip conversions
- ✅ Amount calculations from liquidity
- ✅ Liquidity calculations from amounts
- ✅ Edge cases (price below/in/above range)

All tests pass with the applied fixes.

## Summary

**Total Issues Found**: 2
- **Fixed**: 1 medium (price impact), 1 low (tick alignment)
- **Core CLMM Math**: ✅ All formulas verified correct
- **Position Logic**: ✅ All logic verified correct
- **Safety Checks**: ✅ Comprehensive validation in place

## Recommendations

### Completed
1. ✅ Fixed price impact denominator
2. ✅ Added explicit tick spacing validation

### Optional Future Improvements
1. Add explicit bounds checking in liquidity functions (defensive programming)
2. Add unit tests for price impact calculations
3. Add integration tests for full rebalancing workflow
4. Consider adding overflow checks for extreme values

## Files Modified

1. `src/PositionManager.ts` - Fixed price impact calculation
2. `src/Worker.ts` - Added tick spacing alignment validation

## Conclusion

The codebase has **sound CLMM mathematics and logical flows**. The identified issue with price impact calculation has been fixed, and additional defensive programming has been added for tick alignment. The bot is now more robust and accurate in its calculations.

**Overall Assessment**: ✅ **PRODUCTION READY** (with fixes applied)
