# Cetus Module Addresses and Move Call Arguments Fix

## Overview
Fixed inconsistencies in Cetus CLMM Move call module addresses and corrected argument issues in the execution layer.

## Issues Fixed

### 1. Module Address Inconsistencies

**Problem**: Execution layer modules used direct `pool::` calls while `CetusPositionManager` used `pool_script::` module.

**Root Cause**: The `pool_script` module is the user-facing wrapper for pool operations in Cetus CLMM, while `pool` is the low-level module. For consistency and correct functionality, all user transactions should use `pool_script`.

**Files Fixed**:
- `src/execution/collectFees.ts`
- `src/execution/removeLiquidity.ts`
- `src/execution/openPosition.ts`
- `src/execution/swap.ts`

**Changes**:
- Changed from `${packageId}::pool::*` to `${packageId}::pool_script::*`
- Added missing `poolsId` argument to all calls

### 2. Missing Clock Object Constant

**Problem**: Hardcoded clock object ID `"0x6"` instead of using the proper constant.

**Fix**: Imported and used `SUI_CLOCK_OBJECT_ID` from `@mysten/sui/utils` in all files.

**Files Fixed**:
- `src/execution/collectFees.ts`
- `src/execution/removeLiquidity.ts`
- `src/execution/openPosition.ts`
- `src/execution/swap.ts`

### 3. Incorrect Reward Collection Arguments

**Location**: `src/execution/collectFees.ts` - `collectReward()` function

**Problem**: 
```typescript
// WRONG: Passing coin type as object
tx.object(poolReward.coin.coinType), // Reward vault
tx.pure.bool(true), // Collect all rewards
```

**Fix**:
```typescript
// CORRECT: Using reward index and amount
tx.pure.u64(rewardIndex), // Reward index
tx.pure.u64("18446744073709551615"), // Max amount (collect all)
```

### 4. Incorrect Tick Handling

**Location**: `src/execution/openPosition.ts`

**Problem**: Used unsigned u32 for ticks which cannot represent negative values.

**Fix**: Properly handle negative ticks:
```typescript
const tickLowerAbs = Math.abs(tickLower);
const tickUpperAbs = Math.abs(tickUpper);
const isTickLowerNegative = tickLower < 0;
const isTickUpperNegative = tickUpper < 0;

// Pass absolute value and sign separately
tx.pure.u32(tickLowerAbs),
tx.pure.bool(isTickLowerNegative),
tx.pure.u32(tickUpperAbs),
tx.pure.bool(isTickUpperNegative),
```

### 5. Fee Collection Arguments

**Location**: `src/execution/collectFees.ts` - `collectFees()` function

**Problem**: Used `tx.pure.bool(true)` which doesn't match the expected arguments.

**Fix**: Use explicit max amounts:
```typescript
tx.pure.u64("18446744073709551615"), // Max amount X (collect all)
tx.pure.u64("18446744073709551615"), // Max amount Y (collect all)
```

## Cetus CLMM Module Structure

### pool_script Module
User-facing wrapper functions that handle common operations:
- `open_position` - Creates new position with liquidity
- `add_liquidity` - Adds liquidity to existing position
- `remove_liquidity` - Removes liquidity from position
- `collect_fee` - Collects accrued fees
- `collect_reward` - Collects protocol rewards
- `close_position` - Closes position NFT
- `swap_a2b` - Swap token A to B
- `swap_b2a` - Swap token B to A

### Expected Arguments for pool_script Functions

#### open_position
```
1. global_config: GlobalConfig
2. pools_id: PoolsRegistry
3. pool: Pool<CoinA, CoinB>
4. position: Position
5. tick_lower_abs: u32
6. is_tick_lower_negative: bool
7. tick_upper_abs: u32
8. is_tick_upper_negative: bool
9. coin_a: Coin<CoinA>
10. coin_b: Coin<CoinB>
11. amount_a_desired: u64
12. amount_b_desired: u64
13. amount_a_min: u64
14. amount_b_min: u64
15. clock: &Clock
```

#### remove_liquidity
```
1. global_config: GlobalConfig
2. pools_id: PoolsRegistry
3. pool: Pool<CoinA, CoinB>
4. position: Position
5. liquidity: u128
6. amount_a_min: u64
7. amount_b_min: u64
8. clock: &Clock
```

#### collect_fee
```
1. global_config: GlobalConfig
2. pools_id: PoolsRegistry
3. pool: Pool<CoinA, CoinB>
4. position: Position
5. amount_a_max: u64
6. amount_b_max: u64
```

#### collect_reward
```
1. global_config: GlobalConfig
2. pools_id: PoolsRegistry
3. pool: Pool<CoinA, CoinB>
4. position: Position
5. reward_index: u64
6. amount_max: u64
7. clock: &Clock
```

#### swap_a2b / swap_b2a
```
1. global_config: GlobalConfig
2. pools_id: PoolsRegistry
3. pool: Pool<CoinA, CoinB>
4. coin_in: Coin<In>
5. amount_in: u64
6. amount_out_min: u64
7. sqrt_price_limit: u128
8. is_exact_input: bool
9. clock: &Clock
```

## Testing

All changes maintain backward compatibility with the existing codebase. The fixes ensure:
1. Consistency with CetusPositionManager implementation
2. Correct argument types and order for Move calls
3. Proper handling of signed tick values
4. Correct use of Sui constants

## Impact

These changes fix potential transaction failures when:
- Opening new positions with negative ticks
- Collecting rewards from positions
- Performing any pool operations (swap, add/remove liquidity, collect fees)

All operations now use the correct module and arguments as expected by Cetus CLMM protocol.
