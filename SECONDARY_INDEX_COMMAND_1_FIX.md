# PTB SecondaryIndexOutOfBounds Fix - Command 1

## Issue Summary
The rebalancing bot was failing with the following error:
```
PTB validation error: Dry run failed, could not automatically determine a budget: 
CommandArgumentError { arg_idx: 2, kind: SecondaryIndexOutOfBounds { result_idx: 0, secondary_idx: 0 } } in command 1
```

## Root Cause

### The Problem
The `safeUseNestedResult()` helper function in `src/utils/ptbHelpers.ts` had incorrect fallback logic that would return the entire moveCall result object instead of the indexed NestedResult reference when accessing `result[0]` or `result[1]`.

### How Sui SDK Works
When you access indexed properties on a Sui SDK moveCall result, the SDK automatically creates proper NestedResult references:

```typescript
const result = ptb.moveCall({ target: 'pool_script::close_position', ... });
console.log(result[0]);  // {"$kind":"NestedResult","NestedResult":[0,0]}
console.log(result[1]);  // {"$kind":"NestedResult","NestedResult":[0,1]}
```

### The Bug
The old code had a fallback that would return the entire result when `index === 0`:

```typescript
// OLD CODE (INCORRECT)
const element = (result as IndexableResult)[index];
if (element === undefined) {
  if (index === 0) {
    return result as T;  // ❌ Returns entire result, not result[0]
  }
  throw new PTBHelperError(...);
}
```

This caused:
1. `close_position` returns `(Coin<A>, Coin<B>)`
2. `safeUseNestedResult(result, 0)` returns entire result object (WRONG)
3. `router::swap` receives wrong type for coinA argument
4. PTB dry-run fails with SecondaryIndexOutOfBounds

## The Fix

### Changes Made
**File**: `src/utils/ptbHelpers.ts` (lines 336-352)

Removed the fallback logic and now always returns the indexed element:

```typescript
// NEW CODE (CORRECT)
const element = (result as IndexableResult)[index];
if (element === undefined) {
  throw new PTBHelperError(
    `Cannot extract nested result at index ${index}: element is undefined. ` +
    `This likely means the moveCall doesn't return a value at index ${index}.`,
    'safeUseNestedResult',
    description
  );
}
logger.debug(`✓ Extracted ${description} from result[${index}]`);
return element as T;  // ✅ Always returns result[index] = NestedResult
```

### Why It Works
1. The Sui SDK creates NestedResult automatically when accessing `result[0]`, `result[1]`, etc.
2. These NestedResult objects contain proper references like `[0, 0]` (command 0, index 0)
3. Subsequent PTB commands can use these references correctly
4. No more SecondaryIndexOutOfBounds errors

## Verification

### Testing
Created test script to verify Sui SDK behavior:
```typescript
const ptb = new Transaction();
const result = ptb.moveCall({ target: '0x1::test::returns_tuple', ... });
console.log(result[0]);  // ✅ {"$kind":"NestedResult","NestedResult":[0,0]}
console.log(result[1]);  // ✅ {"$kind":"NestedResult","NestedResult":[0,1]}
```

### Quality Checks
- ✅ TypeScript compilation: Success
- ✅ Code review: All comments addressed
- ✅ CodeQL security scan: 0 alerts found
- ✅ Build artifacts: Verified in dist/utils/ptbHelpers.js

## Expected Behavior After Fix

The bot should now successfully:
1. ✅ Close the old position and capture returned coins
2. ✅ Extract coinA and coinB using proper NestedResult references
3. ✅ Pass correct arguments to router::swap
4. ✅ Execute the full atomic rebalancing PTB
5. ✅ Complete rebalancing without SecondaryIndexOutOfBounds errors

## Related Documentation

This fix complements previous SecondaryIndexOutOfBounds fixes:
- `PTB_SECONDARY_INDEX_FIX.md` - Command ordering issues (zero coins)
- `FIX_SUMMARY_SECONDARY_INDEX.md` - open_position single value return
- `SECONDARY_INDEX_FIX_COMMAND_11.md` - Command 11 array indexing

Each fix addresses a different aspect of PTB command construction and result handling.

## Technical Details

### Command Flow
```
Command 0: close_position → (Coin<A>, Coin<B>)
  ↓ (extract using safeUseNestedResult)
  stableCoinA = NestedResult[0, 0]
  stableCoinB = NestedResult[0, 1]
  ↓
Command 1: router::swap
  arg 0: globalConfigId
  arg 1: pool.id
  arg 2: stableCoinA ✅ Proper NestedResult reference
  arg 3: stableCoinB ✅ Proper NestedResult reference
  ...
```

### PTB Argument Resolution
During PTB execution, Sui resolves NestedResult references:
- `NestedResult[0, 0]` → "Get the result from command 0, index 0"
- `NestedResult[0, 1]` → "Get the result from command 0, index 1"

The fix ensures these references are created correctly by the Sui SDK.

## Minimal Change Philosophy

This fix follows the minimal change principle:
- **1 file changed**: `src/utils/ptbHelpers.ts`
- **Lines modified**: Removed 3 lines of incorrect fallback logic
- **Added documentation**: Clarifying comments about Sui SDK behavior
- **No API changes**: Function signature remains the same
- **Backward compatible**: Existing code continues to work

The fix is surgical and precise, addressing only the specific bug without unnecessary refactoring.
