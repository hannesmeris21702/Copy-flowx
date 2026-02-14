# Cetus CLMM Position Manager

A production-ready tool for managing Cetus Protocol CLMM positions on Sui blockchain.

## Features

### Monitoring Mode (Default - Safe)
- Monitors your Cetus CLMM position health
- Checks if current price is within position range
- Calculates price deviation when out of range
- Suggests optimal rebalancing ranges
- Alerts when deviation exceeds threshold
- Logs all data for manual review
- **No transactions executed**

### Automated Rebalancing Mode (Advanced)
- **⚠️ Executes transactions automatically**
- Uses atomic Programmable Transaction Blocks (PTB)
- All operations in single transaction (all-or-nothing)
- Proper slippage protection
- Gas safety checks
- Automatic rebalancing when thresholds exceeded

## Atomic Rebalancing Implementation

The rebalancing uses a **single Programmable Transaction Block** with all operations:

1. Remove liquidity from old position
2. Collect accumulated fees
3. Merge liquidity with fees
4. Close old position NFT
5. Swap tokens to optimal ratio (if needed)
6. Open new position at current price
7. Add liquidity to new position
8. Transfer new position to wallet

**All operations execute atomically** - if any step fails, the entire transaction reverts (no partial state).

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env`:

```bash
# Required
PRIVATE_KEY=0x...          # Your wallet private key
POOL_ID=0x...             # Cetus pool to manage

# Optional - if not provided, bot scans wallet for pool positions
POSITION_ID=0x...         # Your position NFT ID

# Mode selection
ENABLE_REBALANCING=false  # Set to 'true' for automated rebalancing

# Optional
RPC_URL=https://fullnode.mainnet.sui.io:443
CHECK_INTERVAL_MS=60000   # Check every 60 seconds
REBALANCE_THRESHOLD_PERCENT=2.0  # Rebalance if 2% outside range
RANGE_WIDTH_PERCENT=5.0   # New position will be 5% wide
MAX_SLIPPAGE_PERCENT=1.0  # Maximum acceptable slippage
MAX_GAS_PRICE=1000000000  # Maximum gas price in MIST
```

## Usage

### Monitoring Only (Default - Recommended)

```bash
npm run build
npm start
```

The bot will:
- Check position every 60 seconds
- Log current state and health
- Alert if deviation exceeds threshold
- **NOT execute any transactions**

### Automated Rebalancing (Advanced)

⚠️ **WARNING**: This mode will execute transactions and spend gas automatically.

Set in `.env`:
```bash
ENABLE_REBALANCING=true
```

Then run:
```bash
npm run build
npm start
```

The bot will:
- Monitor position continuously
- Automatically rebalance when threshold exceeded
- Execute atomic PTB transactions
- Handle slippage and gas safety

## How It Works

### Position Monitoring

1. Fetches pool and position data from Cetus
2. Checks if current price is within position range
3. Calculates price deviation percentage
4. Determines if rebalancing is needed

### Atomic Rebalancing (when enabled)

When price moves beyond threshold:

```
Current tick: 12000
Position range: [10000, 11000]
Deviation: 10% (exceeds 2% threshold)

Action: Atomic rebalance
- Remove all liquidity
- Collect fees
- Close old position
- Calculate new range [11500, 12500] (centered on current price)
- Swap tokens if needed
- Open new position
- Add liquidity

Result: Position centered on current price, earning fees again
```

### Safety Features

#### Monitoring Mode
✅ Read-only operations  
✅ No transaction execution  
✅ No gas spending  
✅ Zero risk  

#### Rebalancing Mode
✅ Atomic PTB (all-or-nothing)  
✅ Slippage protection on all operations  
✅ Gas price checks before execution  
✅ Tick spacing validation  
✅ Bounds checking  
✅ Automatic rollback on failure  

## Project Structure

```
src/
├── config/               # Environment validation
├── services/
│   ├── bot.ts               # Monitoring-only orchestrator
│   ├── rebalancingBot.ts    # Automated rebalancing orchestrator
│   ├── rebalanceService.ts  # Atomic PTB rebalancing logic
│   ├── cetusService.ts      # Cetus SDK integration
│   ├── monitorService.ts    # Position monitoring
│   └── suiClient.ts         # Sui RPC client
├── utils/
│   ├── logger.ts            # Winston logging
│   ├── retry.ts             # Exponential backoff
│   └── tickMath.ts          # CLMM calculations
└── types/                # TypeScript interfaces
```

## Technical Details

### CLMM Mathematics

Uses verified Uniswap V3 / Cetus formulas:
- Tick to sqrt price conversion
- Amount calculations from liquidity
- Price-based range calculations (not tick-based)
- Proper Q64 fixed-point arithmetic

### Atomic Transaction Structure

Single PTB with chained operations:
```typescript
const ptb = new Transaction();

// All operations use returned coin objects
const [coinA, coinB] = ptb.moveCall({ target: 'remove_liquidity', ... });
const [feeA, feeB] = ptb.moveCall({ target: 'collect_fee', ... });
ptb.mergeCoins(coinA, [feeA]);
// ... continue chaining

// Single execution
await client.signAndExecuteTransaction({ transaction: ptb });
```

### Error Handling

**Monitoring Mode**: Logs errors, continues running

**Rebalancing Mode**: 
- Pre-validates gas price
- Validates tick spacing
- Calculates expected amounts
- If any validation fails → abort before execution
- If PTB fails → entire transaction reverts (clean state)

## Examples

### Monitor Output

```
=== Position Monitor Report ===
Pool: 0xabc...
Position: 0xdef...
Current Tick: 12500
Position Range: [12000, 13000]
In Range: YES
Position is healthy
===============================
```

When out of range:
```
In Range: NO
Price Deviation: 3.45%
Suggested New Range: [12450, 12950]
ALERT: Deviation exceeds threshold (2%)
Rebalancing will be triggered
```

### Rebalance Output

```
=== Starting Atomic PTB Rebalance ===
Current tick: 12500
Old range: [10000, 11000]
New range: [12000, 13000]
Expected amounts: A=1000000, B=500000
Min amounts (1% slippage): A=990000, B=495000
Building atomic PTB with all operations...
Step 1: Remove liquidity
Step 2: Collect fees
Step 3: Merge coins
Step 4: Close old position
Step 5: Swap to optimal ratio (if needed)
Step 6: Open new position
Step 7: Add liquidity to new position
Step 8: Transfer new position to sender
Executing atomic PTB...
Rebalance successful! Digest: 0x123...
=== Atomic PTB Rebalance Complete ===
```

## Troubleshooting

### "Gas price too high"
- Wait for lower gas prices
- Increase `MAX_GAS_PRICE` in config

### "Slippage too high"
- Price is moving too fast
- Increase `MAX_SLIPPAGE_PERCENT` (carefully)
- Wait for calmer market conditions

### "Tick spacing validation failed"
- Bug in range calculation
- Report issue with pool details

## Documentation

- **FAILURE_SCENARIOS.md** - Analysis of failure cases and why PTB is safe
- **ATOMIC_REBALANCING_DESIGN.md** - Complete technical design
- **STRUCTURAL_REVIEW.md** - Why previous implementation was removed
- **SUMMARY.md** - Project overview

## Safety First

**Start with monitoring mode** to understand how the bot works before enabling automated rebalancing.

**Automated rebalancing** executes real transactions with real funds. Only enable after:
1. Understanding the code
2. Testing on testnet (if available)
3. Monitoring mode works correctly
4. Comfortable with gas costs
5. Understanding MEV risks

## License

ISC
