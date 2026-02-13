# GitHub Copilot Auto-Fix Mode with Error Lens Integration

## Overview

This document explains how to use GitHub Copilot's auto-fix mode with Error Lens integration for automatic PTB (Programmable Transaction Block) validation and error correction.

## Features

### 1. Pre-Build PTB Validation

PTB transactions are validated **before** execution using `client.dryRunTransactionBlock()`. This catches errors early and provides immediate feedback.

**Location**: `src/utils/ptbValidator.ts`

```typescript
// Validates PTB structure before build
await PTBValidator.validateBeforeBuild(tx, client, senderAddress);
```

**What it validates**:
- Command structure integrity
- Result index references (detects `result[x][y]` issues)
- SecondaryIndexOutOfBounds errors before runtime
- Type argument consistency

### 2. Error Lens Integration

Error Lens shows inline diagnostics directly in your editor with Copilot fix suggestions.

**Configuration**: `.vscode/settings.json`

```json
{
  "errorLens.enabled": true,
  "errorLens.followCursor": "activeLine",
  "errorLens.messageEnabled": true
}
```

**Benefits**:
- Real-time error visibility
- Inline fix suggestions
- No need to check console/terminal
- Immediate feedback on PTB issues

### 3. Copilot Auto-Fix Directives

Special `@copilot` comments trigger GitHub Copilot's auto-fix mode:

```typescript
// @copilot Fix: Use conditional mergeCoins pattern. 
// Check if coin exists before merge:
// if (willReturnCoin) { ptb.mergeCoins(destination, [source]); }
```

**Where to find them**:
- `src/services/suiClient.ts` - Error handling
- `src/services/rebalanceService.ts` - Merge operations
- `src/utils/ptbValidator.ts` - Validation logic

### 4. Safe Merge Patterns

PTBValidator provides `conditionalMerge()` to prevent SecondaryIndexOutOfBounds:

```typescript
// ❌ UNSAFE: May fail if coin doesn't exist
ptb.mergeCoins(destination, [source]);

// ✅ SAFE: Only merges if coin exists
PTBValidator.conditionalMerge(
  ptb,
  destination,
  willReturnCoin ? [source] : [],
  'description'
);
```

## How to Use

### Setup

1. **Install Recommended Extensions** (VS Code will prompt automatically):
   - GitHub Copilot
   - GitHub Copilot Chat
   - Error Lens
   - TypeScript (latest)

2. **Enable Copilot** (if not already enabled):
   - Open VS Code Settings
   - Search for "Copilot"
   - Enable "Editor: Inline Suggest"

3. **Verify Error Lens**:
   - Open a TypeScript file
   - You should see inline error messages
   - If not, check `.vscode/settings.json`

### Using Pre-Build Validation

Pre-build validation runs automatically in `executeWithRetry()`:

```typescript
// In your code
const result = await suiClient.executeTransactionWithoutSimulation(ptb);

// Validation happens here (before execution):
// 1. PTB structure is validated
// 2. Dry-run is performed
// 3. Errors are caught with fix suggestions
```

**Check logs for validation results**:
```
🔍 Running pre-build PTB validation...
  Commands: 12
  Validating command structure...
  Running dry-run validation...
✓ Pre-build validation passed
```

### Handling SecondaryIndexOutOfBounds

When validation detects SecondaryIndexOutOfBounds, you'll see:

```
❌ PTB Validation Failed (detected before execution)
  Error Type: SecondaryIndexOutOfBounds
  Command: 4
  Message: Attempted to access result[3][0] but it doesn't exist
  💡 Copilot Fix Suggestion:
     @copilot Fix: Use conditional mergeCoins pattern.
     Check if coin exists before merge:
     if (willReturnCoin) { ptb.mergeCoins(destination, [source]); }
```

**Error Lens shows this inline** at the problematic line.

**To fix**:
1. Click on the error in Error Lens
2. Use Copilot Chat: `/fix` to get AI-generated fix
3. Or manually apply the conditional pattern:

```typescript
// Before (causes error)
const [coin] = closePositionResult;
ptb.mergeCoins(stableCoin, [coin]);

// After (safe)
if (willReturnCoin) {
  const [coin] = closePositionResult;
  PTBValidator.conditionalMerge(
    ptb,
    stableCoin,
    [coin],
    'close_position result'
  );
}
```

### Using Copilot /fix Command

1. **Open Copilot Chat** (Ctrl+Shift+I or Cmd+Shift+I)
2. **Select problematic code**
3. **Type**: `/fix` and press Enter
4. **Review suggestion** and apply

Example session:
```
You: /fix
Copilot: I see a SecondaryIndexOutOfBounds error. The issue is accessing 
         result[3][0] when close_position might not return a coin.
         
         Here's the fix:
         [Shows conditional merge pattern]
```

## Common PTB Issues and Fixes

### Issue 1: SecondaryIndexOutOfBounds

**Error**: `result_idx:3 secondary_idx:0`

**Cause**: Accessing `result[3][0]` when command 3 doesn't return a coin at index 0

**Fix**:
```typescript
// Add conditional check
if (positionHasLiquidity && willReturnCoinA) {
  const [coinA] = closePositionResult;
  PTBValidator.conditionalMerge(ptb, stableCoinA, [coinA], 'coinA');
}
```

### Issue 2: Invalid Result Index

**Error**: `Command 4 references future result[5]`

**Cause**: Command tries to use result from a later command

**Fix**:
```typescript
// Ensure commands are in correct order
// Create coins BEFORE moveCall operations
const zeroCoin = coinWithBalance({ type, balance: 0 })(ptb);  // First
const result = ptb.moveCall({ ... });  // Then reference it
```

### Issue 3: Type Mismatch

**Error**: `Type argument normalization failed`

**Cause**: Type arguments not properly normalized

**Fix**: Already handled by `normalizeTypeArguments()` utility

## Debug Helpers

### Log PTB Structure

```typescript
PTBValidator.logCommandStructure(ptb, 'MY PTB');
```

Output:
```
=== MY PTB COMMAND STRUCTURE ===
Total commands: 8
Command 0: SplitCoins
Command 1: SplitCoins
Command 2: MoveCall
  Target: 0x...::pool_script_v2::collect_fee
Command 3: MoveCall
  Target: 0x...::pool_script::close_position
...
=== END MY PTB ===
```

### Enable Debug Logging

Set log level to `debug` to see detailed validation:

```typescript
// In config
{
  logLevel: 'debug'  // Shows all validation steps
}
```

## Best Practices

### 1. Always Use Conditional Merges

When merging coins from operations that may not return them:

```typescript
// ✅ GOOD
if (willReturnCoin) {
  PTBValidator.conditionalMerge(ptb, dest, [source], 'description');
}

// ❌ BAD
ptb.mergeCoins(dest, [source]);  // May fail if source doesn't exist
```

### 2. Create Helper Coins First

Create zero-balance coins at the start of PTB construction:

```typescript
// ✅ GOOD ORDER
const zeroCoinA = coinWithBalance({ type, balance: 0 })(ptb);  // Command 0
const zeroCoinB = coinWithBalance({ type, balance: 0 })(ptb);  // Command 1
const result = ptb.moveCall({ ... });  // Command 2

// ❌ BAD ORDER
const result = ptb.moveCall({ ... });  // Command 0
const zeroCoinA = coinWithBalance({ type, balance: 0 })(ptb);  // Command 1
// Now result indices are confusing
```

### 3. Check Pre-Build Validation Logs

Before executing, verify validation passed:

```
✓ Pre-build validation passed
```

If you see warnings, investigate before proceeding:

```
⚠ Potential issue at command 4: References future result[5][0]
```

### 4. Use Descriptive Merge Descriptions

Help debugging by using clear descriptions:

```typescript
PTBValidator.conditionalMerge(
  ptb,
  stableCoinA,
  [coinA],
  'close_position coinA (result[3][0]) - BASE LIQUIDITY'  // Clear description
);
```

### 5. Follow Cetus SDK Patterns

The conditional merge pattern follows Cetus SDK examples:

- Create stable coin references using `splitCoins(zeroCoin, [0])`
- Check liquidity before merging
- Merge close_position results first (base liquidity)
- Merge collect_fee results second (optional additions)

## Troubleshooting

### Error Lens Not Showing Messages

1. Check extension is installed: `usernamehw.errorlens`
2. Verify settings in `.vscode/settings.json`
3. Reload VS Code window

### Copilot Not Suggesting Fixes

1. Ensure Copilot is enabled and logged in
2. Check for `@copilot` comments near errors
3. Try using `/fix` in Copilot Chat explicitly

### Pre-Build Validation Failing

1. Check logs for specific error message
2. Look for "💡 Copilot Fix Suggestion" in output
3. Review command structure with `logCommandStructure()`
4. Verify conditional merge patterns are used

### Dry-Run Timeout

If validation is slow:
1. Check network connection to RPC
2. Verify RPC URL is responding
3. Consider increasing timeout in config

## Examples

### Example 1: Safe Position Closing

```typescript
// Determine what coins will be returned
const willReturnCoinA = positionHasLiquidity && currentTick <= position.tickUpper;
const willReturnCoinB = positionHasLiquidity && currentTick >= position.tickLower;

// Close position
const closePositionResult = ptb.moveCall({ ... });

// Safe conditional merge
if (willReturnCoinA) {
  const [coinA] = closePositionResult;
  PTBValidator.conditionalMerge(
    ptb,
    stableCoinA,
    [coinA],
    'close_position coinA - BASE LIQUIDITY'
  );
}

if (willReturnCoinB) {
  const [, coinB] = closePositionResult;  // Note: skip first if only B
  PTBValidator.conditionalMerge(
    ptb,
    stableCoinB,
    [coinB],
    'close_position coinB - BASE LIQUIDITY'
  );
}
```

### Example 2: Fee Collection

```typescript
// Collect fees (always returns both coins, may be zero balance)
const collectFeeResult = ptb.moveCall({ ... });
const [feeCoinA, feeCoinB] = collectFeeResult;

// Only merge if position has liquidity (optimization)
if (positionHasLiquidity) {
  PTBValidator.conditionalMerge(
    ptb,
    stableCoinA,
    [feeCoinA],
    'collect_fee coinA - OPTIONAL ADDITION'
  );
  
  PTBValidator.conditionalMerge(
    ptb,
    stableCoinB,
    [feeCoinB],
    'collect_fee coinB - OPTIONAL ADDITION'
  );
}
```

## References

- [Sui PTB Documentation](https://docs.sui.io/concepts/transactions/prog-txn-blocks)
- [Cetus CLMM SDK](https://github.com/CetusProtocol/cetus-clmm-interface)
- [GitHub Copilot Docs](https://docs.github.com/en/copilot)
- [Error Lens Extension](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens)

## Related Files

- `PTB_SECONDARY_INDEX_FIX.md` - Detailed explanation of SecondaryIndexOutOfBounds
- `MOVE_FUNCTION_FIX_SUMMARY.md` - Move function signatures
- `ATOMIC_REBALANCING_DESIGN.md` - Overall rebalancing design
- `src/utils/ptbValidator.ts` - Validation implementation
- `.vscode/settings.json` - Editor configuration
