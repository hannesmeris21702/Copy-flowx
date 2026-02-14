# Structured Logging Implementation

## Overview

This document describes the structured logging system implemented for key rebalancing events in the Copy-flowx bot. The implementation provides machine-parseable, consistent logs for monitoring, alerting, and debugging.

## Problem Solved

**Before:**
- Plain text logs with inconsistent formatting
- Difficult to parse programmatically
- Hard to search and filter
- No transaction tracking
- Missing key context in some logs

**After:**
- Structured, machine-parseable logs
- Consistent format across all events
- Easy to search and filter by event type
- Transaction digests included for tracking
- Complete context for every event

## Structured Log Events

### 1. Out-of-Range Detection

**Method:** `logOutOfRangeDetection()`

**Triggered:** When position is detected to be out of range

**Format:**
```
⚠️  OUT_OF_RANGE_DETECTED
  Position: 0xabc123...
  Current Tick: 15000
  Range: [12000, 14000]
  Liquidity: 1000000
  Status: ABOVE RANGE
```

**Parameters:**
- `currentTick`: Current pool tick
- `tickLower`: Position lower tick bound
- `tickUpper`: Position upper tick bound
- `positionId`: Position NFT ID
- `liquidity`: Position liquidity amount

**Use Cases:**
- Alert when position goes out of range
- Track frequency of rebalancing
- Analyze price movements

### 2. Position Closed

**Method:** `logPositionClosed()`

**Triggered:** After successfully closing a position

**Format:**
```
✅ POSITION_CLOSED
  Position: 0xabc123...
  Pool: 0xdef456...
  Transaction: 0x789xyz...
  Liquidity: 100% removed
  Fees: Collected
  NFT: Closed
```

**Parameters:**
- `positionId`: Position NFT ID
- `poolId`: Pool ID
- `success`: true (always logged on success)
- `transactionDigest`: Transaction hash

**Use Cases:**
- Verify position closure
- Track transaction hashes
- Monitor successful closures

### 3. Wallet Balances

**Method:** `logWalletBalances()`

**Triggered:** After querying wallet balances

**Format:**
```
💰 WALLET_BALANCES (After position close)
  Token A: 1000000
    Type: 0x2::sui::SUI
  Token B: 500000
    Type: 0x...::usdc::USDC
```

**Parameters:**
- `tokenA.balance`: Token A balance
- `tokenA.type`: Token A coin type
- `tokenB.balance`: Token B balance
- `tokenB.type`: Token B coin type
- `context`: Optional context label

**Use Cases:**
- Track available liquidity
- Verify coins returned to wallet
- Monitor token balances over time

### 4. Swap Execution

**Method:** `logSwap()` (Enhanced)

**Triggered:** After executing a token swap

**Format:**
```
🔄 SWAP_EXECUTED: A to B →
  Reason: Ratio mismatch 75% exceeds tolerance 5%
  Input Amount: 66667
  Output Amount: 166667
  Price: 2.500000
  Slippage: 1.0%
  Transaction: 0xabc123...
```

**Parameters:**
- `direction`: SwapDirection.A_TO_B or SwapDirection.B_TO_A
- `reason`: Why swap was needed
- `inputAmount`: Amount being swapped
- `outputAmount`: Expected output amount
- `price`: Current pool price (new)
- `slippage`: Slippage percentage (new)
- `transactionDigest`: Transaction hash (new)

**Special Case - No Swap:**
```
⊘ SWAP_NOT_REQUIRED - Ratio within tolerance
```

**Use Cases:**
- Track swap economics
- Monitor price impact
- Verify slippage settings
- Analyze swap patterns

### 5. Position Opened

**Method:** `logOpenPosition()` (Enhanced)

**Triggered:** After opening a new position

**Format:**
```
✅ POSITION_OPENED
  Position ID: 0x789xyz...
  Pool: 0xdef456...
  Range: [12000, 14000]
  Transaction: 0xabc123...
```

**Parameters:**
- `poolId`: Pool ID
- `positionId`: New position NFT ID (new)
- `tickLower`: Lower tick bound
- `tickUpper`: Upper tick bound
- `success`: true (always logged on success)
- `transactionDigest`: Transaction hash (new)

**Use Cases:**
- Track new position creation
- Monitor position ranges
- Verify position IDs

### 6. Liquidity Added

**Method:** `logAddLiquidity()` (Enhanced)

**Triggered:** After adding liquidity to position

**Format:**
```
✅ LIQUIDITY_ADDED
  Position: 0x789xyz...
  Amount A: 950000
  Amount B: 450000
  Transaction: 0xdef456...
```

**Parameters:**
- `positionId`: Position NFT ID
- `amountA`: Token A amount added
- `amountB`: Token B amount added
- `success`: true (always logged on success)
- `transactionDigest`: Transaction hash (new)

**Use Cases:**
- Verify liquidity amounts
- Track liquidity distribution
- Monitor transaction completion

## Log Format Conventions

### Emoji Prefixes

- ⚠️ - Warnings/Detection events
- ✅ - Successful actions
- ❌ - Failed actions
- 💰 - Balance/Value information
- 🔄 - Swap operations
- ⊘ - Negative/Skip events
- ⏭️ - Skipped operations (resume)

### Status Indicators

- `SUCCESS` - Operation completed successfully
- `BELOW RANGE` - Price is below position range
- `ABOVE RANGE` - Price is above position range
- `YES`/`NO` - Boolean status values

### Field Naming

- Consistent field names across all logs
- Clear, descriptive labels
- Hierarchical indentation for nested data

## Implementation Details

### BotLogger Class

Location: `src/utils/botLogger.ts`

**New Methods:**
```typescript
logOutOfRangeDetection(params: {
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  positionId: string;
  liquidity: string;
}): void

logPositionClosed(params: {
  positionId: string;
  poolId: string;
  success: boolean;
  transactionDigest?: string;
}): void

logWalletBalances(params: {
  tokenA: { type: string; balance: string };
  tokenB: { type: string; balance: string };
  context?: string;
}): void
```

**Enhanced Methods:**
```typescript
// Now includes price, slippage, and transactionDigest
logSwap(params: {
  direction: SwapDirection;
  reason?: string;
  inputAmount?: string;
  outputAmount?: string;
  price?: string;          // NEW
  slippage?: string;       // NEW
  transactionDigest?: string; // NEW
}): void

// Now includes positionId and transactionDigest
logOpenPosition(params: {
  poolId: string;
  positionId?: string;     // NEW
  tickLower: number;
  tickUpper: number;
  success: boolean;
  transactionDigest?: string; // NEW
}): void

// Now includes transactionDigest
logAddLiquidity(params: {
  positionId: string;
  amountA: string;
  amountB: string;
  success: boolean;
  transactionDigest?: string; // NEW
}): void
```

### RebalanceService Integration

Location: `src/services/rebalanceService.ts`

**Updated Helper Methods:**

All helper methods now return transaction digests:

```typescript
private async closePosition(pool, position): Promise<{ digest?: string }>
private async executeSwap(...): Promise<{ digest?: string }>
private async openPosition(...): Promise<{ positionId: string; digest?: string }>
private async addLiquidity(...): Promise<{ digest?: string }>
```

**Structured Log Calls:**

```typescript
// After OUT_OF_RANGE detection
logOutOfRangeDetection({
  currentTick: pool.currentTick,
  tickLower: position.tickLower,
  tickUpper: position.tickUpper,
  positionId: position.id,
  liquidity: position.liquidity.toString(),
});

// After position close
logPositionClosed({
  positionId: position.id,
  poolId: pool.id,
  success: true,
  transactionDigest: closeResult?.digest,
});

// After wallet balance query
logWalletBalances({
  tokenA: {
    type: pool.coinTypeA,
    balance: availableA.toString(),
  },
  tokenB: {
    type: pool.coinTypeB,
    balance: availableB.toString(),
  },
  context: 'After position close',
});

// After swap execution
logSwap({
  direction: swapDetails.swapFromA ? SwapDirection.A_TO_B : SwapDirection.B_TO_A,
  reason: swapCheck.reason,
  inputAmount: swapDetails.swapAmount.toString(),
  outputAmount: swapDetails.expectedOutput.toString(),
  price: currentPrice.toFixed(6),
  slippage: this.config.maxSlippagePercent.toString(),
  transactionDigest: swapResult?.digest,
});

// After position opening
logOpenPosition({
  poolId: pool.id,
  positionId: newPositionId,
  tickLower: newRange.tickLower,
  tickUpper: newRange.tickUpper,
  success: true,
  transactionDigest: openResult.digest,
});

// After liquidity addition
logAddLiquidity({
  positionId: newPositionId,
  amountA: liquidityAmounts.amountA.toString(),
  amountB: liquidityAmounts.amountB.toString(),
  success: true,
  transactionDigest: liquidityResult?.digest,
});
```

## Parsing Structured Logs

### Log Aggregation Tools

The structured format is designed to work well with:
- **Splunk** - Index on event types (OUT_OF_RANGE_DETECTED, etc.)
- **ELK Stack** - Parse structured fields with Logstash
- **Datadog** - Custom log parsing rules
- **CloudWatch** - Metric filters on structured fields

### Example Queries

**Find all out-of-range detections:**
```
search "OUT_OF_RANGE_DETECTED"
```

**Find all successful swaps:**
```
search "SWAP_EXECUTED" AND success=true
```

**Find positions opened in specific range:**
```
search "POSITION_OPENED" AND "Range: [12000, 14000]"
```

**Track specific position:**
```
search positionId="0xabc123..."
```

## Monitoring and Alerting

### Recommended Alerts

1. **High Rebalancing Frequency**
   - Trigger: > 10 OUT_OF_RANGE_DETECTED per hour
   - Action: Review range width settings

2. **Large Slippage**
   - Trigger: Swap slippage > 2%
   - Action: Investigate price impact

3. **Failed Transactions**
   - Trigger: Any ❌ status logs
   - Action: Review error logs and retry

4. **Value Loss**
   - Trigger: Final value < original value * 0.98
   - Action: Review swap economics

### Dashboard Metrics

Suggested metrics to track:
- Rebalancing frequency (OUT_OF_RANGE_DETECTED count)
- Average swap size (SWAP_EXECUTED amounts)
- Average slippage (SWAP_EXECUTED slippage)
- Position lifecycle duration
- Value preservation rate

## Benefits

### For Development

✅ **Debugging:** Easy to trace execution flow
✅ **Testing:** Verify correct behavior from logs
✅ **Documentation:** Logs serve as execution documentation

### For Operations

✅ **Monitoring:** Track key metrics automatically
✅ **Alerting:** Set alerts on structured events
✅ **Analytics:** Analyze bot performance over time

### For Users

✅ **Transparency:** Complete visibility into bot actions
✅ **Trust:** Verifiable transaction hashes
✅ **Understanding:** Clear explanation of each step

## Example Complete Log Sequence

```
⚠️  OUT_OF_RANGE_DETECTED
  Position: 0xposition123...
  Current Tick: 15000
  Range: [12000, 14000]
  Liquidity: 1000000
  Status: ABOVE RANGE

✅ POSITION_CLOSED
  Position: 0xposition123...
  Pool: 0xpool456...
  Transaction: 0xtx789...
  Liquidity: 100% removed
  Fees: Collected
  NFT: Closed

💰 WALLET_BALANCES (After position close)
  Token A: 1000000
    Type: 0x2::sui::SUI
  Token B: 500000
    Type: 0x...::usdc::USDC

🔄 SWAP_EXECUTED: A to B →
  Reason: Ratio mismatch 75% exceeds tolerance 5%
  Input Amount: 66667
  Output Amount: 166667
  Price: 2.500000
  Slippage: 1.0%
  Transaction: 0xtx890...

✅ POSITION_OPENED
  Position ID: 0xnewpos456...
  Pool: 0xpool456...
  Range: [13000, 15000]
  Transaction: 0xtx901...

✅ LIQUIDITY_ADDED
  Position: 0xnewpos456...
  Amount A: 933333
  Amount B: 466667
  Transaction: 0xtx012...
```

## Future Enhancements

Potential improvements:
1. Add JSON-formatted structured logs option
2. Include gas costs in transaction logs
3. Add performance timing metrics
4. Include health check status logs
5. Add summary statistics at end of rebalance

## Conclusion

The structured logging system provides:
- Complete visibility into bot operations
- Machine-parseable format for automation
- Transaction tracking for verification
- Foundation for monitoring and alerting

All logs are designed to be both human-readable and machine-parseable, making them suitable for both development debugging and production monitoring.
