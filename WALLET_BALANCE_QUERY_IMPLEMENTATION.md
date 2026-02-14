# Wallet Balance Querying After Position Closure

## Overview
After closing a position when OUT_OF_RANGE is detected, the system now queries the wallet balances for both tokens and stores them as `availableA` and `availableB`. These balances represent the ONLY liquidity source available for creating a new position.

## Implementation

### New Method: `getWalletBalance()`

Added to `SuiClientService`:
```typescript
async getWalletBalance(coinType: string): Promise<bigint>
```

**Parameters:**
- `coinType`: The coin type to query (e.g., "0x2::sui::SUI" or pool-specific token types)

**Returns:**
- `bigint`: The total balance for the specified coin type in the wallet

**Features:**
- Uses Sui SDK's `client.getBalance()` method
- Includes retry logic for reliability (uses existing retry configuration)
- Logs debug information for balance queries
- Throws descriptive errors on failure

**Implementation:**
```typescript
async getWalletBalance(coinType: string): Promise<bigint> {
  try {
    return await withRetry(
      async () => {
        const address = this.getAddress();
        const balance = await this.client.getBalance({
          owner: address,
          coinType: coinType,
        });
        
        logger.debug(`Balance for ${coinType}: ${balance.totalBalance}`);
        return BigInt(balance.totalBalance);
      },
      this.config.maxRetries,
      this.config.minRetryDelayMs,
      this.config.maxRetryDelayMs,
      'Get wallet balance'
    );
  } catch (error) {
    logger.error(`Failed to get wallet balance for ${coinType}`, error);
    throw error;
  }
}
```

### Updated Rebalance Flow

The `rebalance()` method now includes a balance query step after closing the position:

```typescript
// 1. Close position (existing)
await this.closePosition(pool, position);
logger.info('✅ Position closed successfully');

// 2. Query wallet balances (NEW)
currentStage = 'query_balances';
logger.info('Querying wallet balances...');

const availableA = await this.suiClient.getWalletBalance(pool.coinTypeA);
const availableB = await this.suiClient.getWalletBalance(pool.coinTypeB);

// 3. Log balances (NEW)
logger.info('=== Wallet Balances (Available Liquidity) ===');
logger.info(`Token A (${pool.coinTypeA}):`);
logger.info(`  Available: ${availableA}`);
logger.info(`Token B (${pool.coinTypeB}):`);
logger.info(`  Available: ${availableB}`);
logger.info('These balances are the ONLY liquidity source for new position');
logger.info('============================================');

// 4. Record in Sentry breadcrumbs (NEW)
addSentryBreadcrumb('Wallet balances queried', 'rebalance', {
  positionId: position.id,
  availableA: availableA.toString(),
  availableB: availableB.toString(),
});
```

## Execution Flow

### Complete Position Closure Sequence

```
1. OUT_OF_RANGE detected
   ↓
2. Pre-execution validation (gas price check)
   ↓
3. Close position
   - Remove 100% liquidity (min_amount_a='0', min_amount_b='0')
   - Collect all fees (collect_fee=true)
   - Close position NFT
   ↓
4. Wait for transaction confirmation
   ↓
5. Query wallet balances (NEW)
   - Get balance for tokenA → availableA
   - Get balance for tokenB → availableB
   ↓
6. Log available balances
   ↓
7. Complete
```

## Log Output Example

### Successful Execution
```
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
  Digest: 0x123abc...
✅ Position closed successfully
All coins have been returned to your wallet

Querying wallet balances...
=== Wallet Balances (Available Liquidity) ===
Token A (0x2::sui::SUI):
  Available: 1000000
Token B (0xabc...::usdc::USDC):
  Available: 500000
These balances are the ONLY liquidity source for new position
============================================

=== Position Closure Complete ===
```

### Error Handling

If balance query fails:
```
✅ Position closed successfully
All coins have been returned to your wallet
Querying wallet balances...
❌ Failed to get wallet balance for 0x2::sui::SUI
Error: [detailed error message]
```

The error will be caught and logged, but the position closure itself has already succeeded. The transaction is not reverted.

## Use Cases

### 1. Position Reopening (Future Feature)
When implementing position reopening functionality:
```typescript
// After getting availableA and availableB
if (availableA > 0 || availableB > 0) {
  // Use availableA and availableB as the liquidity source
  await this.openPosition(pool, newRange);
  await this.addLiquidity(pool, newRange, positionId, availableA, availableB);
}
```

### 2. Manual Position Creation
Users can see exactly how much liquidity is available:
```
Available balances:
- Token A: 1000000 (can be used for new position)
- Token B: 500000 (can be used for new position)
```

### 3. Monitoring & Debugging
- Sentry breadcrumbs include balance information
- Logs clearly show available liquidity
- Helps diagnose issues with position creation

## Technical Details

### Balance Query Method
Uses Sui SDK's `getBalance()` method:
```typescript
await client.getBalance({
  owner: walletAddress,
  coinType: coinType,
});
```

**Returns:**
```typescript
{
  coinType: string;
  coinObjectCount: number;
  totalBalance: string;
  lockedBalance: {
    epochId: number;
    number: string;
  };
}
```

We use `totalBalance` which includes all available (unlocked) balance.

### Retry Logic
The balance query uses the same retry configuration as other operations:
- `maxRetries`: From BotConfig (default: 5)
- `minRetryDelayMs`: Minimum delay between retries
- `maxRetryDelayMs`: Maximum delay with exponential backoff

### Error Handling
If balance query fails:
1. Error is logged with full details
2. Error is thrown to caller
3. Rebalance process stops (but position is already closed)
4. User can manually check wallet balance

## Benefits

### 1. Visibility
Users can see exactly how much liquidity is available after closing a position.

### 2. Traceability
Balances are logged and recorded in Sentry for debugging and monitoring.

### 3. Foundation for Future Features
These balance values can be used for:
- Automatic position reopening
- Liquidity validation before creating new positions
- Balance-based decision making

### 4. Safety
Knowing the exact available balances prevents:
- Attempting to add more liquidity than available
- Creating positions with insufficient funds
- Slippage issues due to incorrect amount calculations

## Configuration

No new configuration parameters required. Uses existing:
- `maxRetries`: Number of retry attempts for balance queries
- `minRetryDelayMs`: Minimum retry delay
- `maxRetryDelayMs`: Maximum retry delay

## Files Modified

### 1. `src/services/suiClient.ts`
**Added:**
- `getWalletBalance(coinType: string): Promise<bigint>` method

**Changes:**
- +29 lines

### 2. `src/services/rebalanceService.ts`
**Added:**
- Balance query step after `closePosition()`
- Logging of available balances
- Sentry breadcrumb for balance tracking

**Changes:**
- +22 lines

## Testing

### Unit Testing
To test the balance query functionality:
```typescript
// Mock Sui client
const mockClient = {
  getBalance: jest.fn().mockResolvedValue({
    totalBalance: '1000000',
    coinType: '0x2::sui::SUI',
    coinObjectCount: 1,
  }),
};

// Test getWalletBalance
const balance = await suiClient.getWalletBalance('0x2::sui::SUI');
expect(balance).toBe(BigInt('1000000'));
```

### Integration Testing
1. Create a position
2. Let it go OUT_OF_RANGE
3. Observe the balance query in logs
4. Verify balances match expected amounts (liquidity + fees)

## Future Enhancements

### 1. Return Balance Values
Instead of just logging, return the balances:
```typescript
async rebalance(pool: Pool, position: Position): Promise<{
  availableA: bigint;
  availableB: bigint;
}> {
  // ... close position ...
  const availableA = await this.suiClient.getWalletBalance(pool.coinTypeA);
  const availableB = await this.suiClient.getWalletBalance(pool.coinTypeB);
  
  return { availableA, availableB };
}
```

### 2. Automatic Position Reopening
Use the balance values to automatically create a new position:
```typescript
if (availableA > minThreshold && availableB > minThreshold) {
  await this.openPosition(pool, calculateNewRange(pool));
  await this.addLiquidity(pool, newRange, positionId, availableA, availableB);
}
```

### 3. Balance-Based Decisions
Make decisions based on available balances:
```typescript
if (availableA === 0 || availableB === 0) {
  logger.warn('Insufficient liquidity to create new position');
  // Notify user or skip position creation
}
```

## Conclusion

The wallet balance querying feature provides visibility into available liquidity after position closure. It serves as a foundation for future features like automatic position reopening while also helping users understand their current liquidity situation.

**Key Points:**
- ✅ Queries balances after close_position confirmation
- ✅ Stores as availableA and availableB
- ✅ Clearly logs available liquidity
- ✅ Records in Sentry for monitoring
- ✅ Foundation for future position reopening
- ✅ These balances are the ONLY liquidity source for new position
