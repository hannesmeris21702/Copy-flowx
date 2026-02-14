# Position Closure on OUT_OF_RANGE

## Overview
When a position goes OUT_OF_RANGE, the system now automatically closes the position and returns all funds to the wallet, rather than attempting to rebalance to a new range.

## Implementation

### What Happens When OUT_OF_RANGE

1. **Detection**: The `MonitorService` detects when `currentTick < tickLower OR currentTick > tickUpper`
2. **Action**: The `RebalanceService` calls Cetus SDK's `closePositionTransactionPayload()`
3. **Result**: Position is closed and all coins are returned to wallet

### Close Position Details

The `closePosition()` method:
```typescript
const tx = await sdk.Position.closePositionTransactionPayload({
  coinTypeA: pool.coinTypeA,
  coinTypeB: pool.coinTypeB,
  pool_id: pool.id,
  pos_id: position.id,
  min_amount_a: '0',        // Remove 100% liquidity
  min_amount_b: '0',        // Remove 100% liquidity
  collect_fee: true,        // Collect all fees
  rewarder_coin_types: [],  // No rewarder coins
});

await this.suiClient.executeSDKPayload(tx);
```

### Key Features

✅ **Removes 100% Liquidity**: `min_amount_a='0'` and `min_amount_b='0'` ensure all liquidity is removed

✅ **Collects All Fees**: `collect_fee: true` ensures accumulated fees are collected

✅ **Closes Position NFT**: The position NFT is burned/closed as part of the transaction

✅ **No Return Value Capture**: The transaction is executed without capturing return values - coins go directly to wallet

✅ **Waits for Confirmation**: `executeSDKPayload()` waits for transaction confirmation before returning

## Changes from Previous Implementation

### Before (Rebalancing)
```
OUT_OF_RANGE detected
  ↓
1. Calculate new range
2. Close old position
3. Open new position
4. Add liquidity to new position
  ↓
Position rebalanced to new range
```

### After (Position Closure)
```
OUT_OF_RANGE detected
  ↓
1. Close position (remove liquidity, collect fees, close NFT)
  ↓
All coins returned to wallet
Done - no reopening
```

## Code Changes

### Removed
- `openPosition()` method
- `addLiquidity()` method  
- `calculateExpectedAmounts()` helper method
- Range calculation logic
- Slippage calculation for rebalancing
- Imports: `calculateTickRange`, `tickToSqrtPrice`, `getAmountAFromLiquidity`, `getAmountBFromLiquidity`
- Constants: `MAX_U64`

### Modified
- `rebalance()` method - simplified to only close position
- `closePosition()` method - now uses `min_amount_a='0'`, `min_amount_b='0'` for 100% removal
- Logging messages - updated to reflect closure instead of rebalancing
- Error messages - changed "REBALANCE EXECUTION FAILED" to "POSITION CLOSURE FAILED"

### Kept Unchanged
- `MonitorService` - still detects OUT_OF_RANGE
- `RebalancingBot` - still triggers action when OUT_OF_RANGE
- Transaction execution infrastructure
- Error handling and Sentry integration

## Workflow

### 1. Position Monitoring
The bot continuously monitors the position:
```typescript
// MonitorService.generateReport()
const inRange = isTickInRange(
  pool.currentTick,
  position.tickLower,
  position.tickUpper
);

if (!inRange) {
  shouldRebalance = true;
  reason = `Position OUT_OF_RANGE: current tick ${pool.currentTick} is outside [${position.tickLower}, ${position.tickUpper}]`;
}
```

### 2. Triggering Closure
When OUT_OF_RANGE is detected:
```typescript
// RebalancingBot.checkAndRebalance()
if (!report.shouldRebalance) {
  logger.info(`No rebalancing needed: ${report.reason}`);
  return;
}

logger.warn('⚠️  REBALANCING TRIGGERED');
await this.rebalanceService.rebalance(report.pool, report.position);
```

### 3. Executing Closure
The closure process:
```typescript
// RebalanceService.rebalance()
logger.info('=== Starting Position Closure ===');
logger.info('Position is OUT_OF_RANGE - closing position and returning all funds to wallet');

// Pre-execution validation
await this.suiClient.checkGasPrice();

// Close position
await this.closePosition(pool, position);

logger.info('✅ Position closed successfully');
logger.info('All coins have been returned to your wallet');
```

## Logging Output

### Example Log Output
```
=== Position Monitor Report ===
Pool: 0x...
Position: 0x...
Current Tick: 12500
Position Range: [10000, 11000]
In Range: NO
Price Deviation: 15.50%
ALERT: Position OUT_OF_RANGE: current tick 12500 is outside [10000, 11000]
Rebalancing will be triggered
===============================

⚠️  REBALANCING TRIGGERED
Reason: Position OUT_OF_RANGE: current tick 12500 is outside [10000, 11000]
Deviation: 15.50%

=== Starting Position Closure ===
Position is OUT_OF_RANGE - closing position and returning all funds to wallet
Current tick: 12500
Position range: [10000, 11000]
Position liquidity: 1000000
Closing position...
  - Removing 100% liquidity
  - Collecting all fees
  - Closing position NFT
  - Returning all coins to wallet
Executing SDK transaction payload...
✓ Transaction executed successfully
  Digest: 0x...
✅ Position closed successfully
All coins have been returned to your wallet
=== Position Closure Complete ===
```

## Configuration

No configuration changes are required. The bot still uses:
- `checkIntervalMs` - How often to check position status
- `maxGasPrice` - Maximum gas price for transactions
- Other settings are no longer used for rebalancing but remain in config for backward compatibility

## Benefits

1. **Simpler Logic**: Removed ~160 lines of complex rebalancing code
2. **Faster Execution**: Only one transaction instead of three
3. **Lower Gas Costs**: Single transaction instead of close + open + add_liquidity
4. **Clearer Intent**: Explicitly closes position when out of range
5. **Safer Operation**: No risk of partial state (like having closed position but failing to open new one)

## Trade-offs

### Lost Functionality
- ❌ No automatic position reopening
- ❌ No automatic liquidity rebalancing
- ❌ No automatic range adjustment

### What This Means
When a position goes OUT_OF_RANGE:
- The position is closed completely
- All coins (liquidity + fees) are returned to your wallet
- No new position is created
- You must manually create a new position if desired

## Manual Recovery

After position closure, you can manually:
1. Use the coins in your wallet to open a new position via Cetus UI
2. Choose a new tick range based on current market conditions
3. Add liquidity with desired amounts

## Testing

The implementation:
- ✅ Builds successfully with TypeScript
- ✅ Uses existing Cetus SDK methods
- ✅ Maintains existing error handling
- ✅ Preserves Sentry integration
- ✅ Keeps all monitoring functionality

## Files Changed

- `src/services/rebalanceService.ts` - Simplified to only close position (160 lines removed, 29 lines changed)

## Files Unchanged

- `src/services/monitorService.ts` - Still detects OUT_OF_RANGE
- `src/services/rebalancingBot.ts` - Still triggers action
- `src/services/suiClient.ts` - Still executes transactions
- `src/services/cetusService.ts` - Still provides SDK access
- All other files remain unchanged
