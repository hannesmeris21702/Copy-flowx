# Fix Summary: SecondaryIndexOutOfBounds Error

## Problem
The bot was failing with the following error during PTB execution:
```
SecondaryIndexOutOfBounds { result_idx: 10, secondary_idx: 0 } in command 11
```

This error occurred every time the bot attempted to rebalance a position, preventing any successful rebalancing operations.

## Root Cause

### The Issue
The code was incorrectly accessing the result of the `open_position` moveCall using array indexing:

```typescript
// INCORRECT - Creates NestedResult(10, 0) reference
const openPositionResult = ptb.moveCall({
  target: `${packageId}::pool_script::open_position`,
  // ... arguments
});
const newPosition = safeUseNestedResultOptional(openPositionResult, 0, 'position NFT');
```

### Why It Failed
1. `open_position` is a **public function** (not entry) that returns a **single Position NFT object**
2. The helper `safeUseNestedResultOptional` accessed `openPositionResult[0]`, creating a `NestedResult(10, 0)` reference
3. At PTB construction time, this reference appeared valid
4. At execution time, trying to access `[0]` on a single-value result caused `SecondaryIndexOutOfBounds` error

### Key Insight
The Mysten SDK creates indexed properties on moveCall results eagerly, making `result[0]` appear to exist during construction. However, if the actual Move function returns a single value (not a tuple), accessing `[0]` at execution time fails because there's no array to index into.

## The Fix

### What Changed
```typescript
// CORRECT - Direct result reference
const newPosition = ptb.moveCall({
  target: `${packageId}::pool_script::open_position`,
  typeArguments: [normalizedCoinTypeA, normalizedCoinTypeB],
  arguments: [
    ptb.object(globalConfigId),
    ptb.object(pool.id),
    ptb.pure.u32(tickLowerU32),
    ptb.pure.u32(tickUpperU32),
  ],
});
```

### Why It Works
1. No array indexing - uses the moveCall result directly
2. Creates `Result(10)` reference instead of `NestedResult(10, 0)`
3. Matches the actual Move function signature (single return value)
4. PTB framework can correctly resolve the reference at execution time

## Additional Changes

### 1. Simplified Logic
Removed unnecessary conditional checks since `open_position` always returns a valid position:
- Removed `if (newPosition)` check
- Removed `else` branch for exceptional case handling
- Atomic transaction guarantees: if `open_position` fails, entire PTB reverts

### 2. Updated transferObjects
Changed from `safeTransferObjects` helper to direct `ptb.transferObjects`:
```typescript
// Direct call is safe because:
// 1. newPosition is a PTB reference (always valid during construction)
// 2. If open_position fails, the entire PTB reverts atomically
// 3. Sui PTB framework validates all object references during execution
ptb.transferObjects([newPosition], ptb.pure.address(this.suiClient.getAddress()));
```

### 3. Cleaned Up Imports
Removed unused imports:
- `safeTransferObjects`
- `safeUseNestedResultOptional`

## Files Modified
- `src/services/rebalanceService.ts` (Lines 393-475)

## Test Results
✅ **Build**: Success (no compilation errors)  
✅ **Code Review**: All comments addressed  
✅ **Security Scan**: 0 alerts found  

## Comparison with Other moveCall Patterns

### Single Value Returns (No Destructuring)
```typescript
// ✅ CORRECT - open_position returns ONE value
const newPosition = ptb.moveCall({
  target: `${packageId}::pool_script::open_position`,
  // ...
});
```

### Multiple Value Returns (Use Destructuring)
```typescript
// ✅ CORRECT - swap returns TWO values (Coin<A>, Coin<B>)
const swapResult = ptb.moveCall({
  target: `${packageId}::router::swap`,
  // ...
});
const swappedCoinA = safeUseNestedResult(swapResult, 0, 'swapped coinA');
const swappedCoinB = safeUseNestedResult(swapResult, 1, 'swapped coinB');
```

### Side Effects Only (No Capture)
```typescript
// ✅ CORRECT - collect_fee called for side effects only
ptb.moveCall({
  target: `${packageId}::pool_script_v2::collect_fee`,
  // ...
});
// No capture - result is discarded
```

## Best Practices

1. **Match Code to Move Signature**: Always verify the Move function's return type before accessing results
2. **Single Value**: Use result directly (no indexing)
3. **Multiple Values**: Use `safeUseNestedResult` for each element
4. **Side Effects Only**: Don't capture the result
5. **Test with Dry-Run**: Always test PTBs with dry-run to catch indexing errors early

## Expected Behavior After Fix

The bot should now successfully:
1. Build the PTB without construction errors
2. Execute the rebalancing transaction
3. Access the position NFT from `open_position` correctly
4. Add liquidity to the new position
5. Transfer the position NFT to the sender

## Related Documentation
- `SECONDARY_INDEX_FIX_COMMAND_11.md` - Original fix documentation
- [Sui PTB Documentation](https://docs.sui.io/concepts/transactions/prog-txn-blocks)
- [Cetus CLMM SDK](https://github.com/CetusProtocol/cetus-clmm-interface)
