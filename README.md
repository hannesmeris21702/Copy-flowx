# Cetus CLMM Position Monitor

A **monitoring-only** tool for Cetus Protocol CLMM positions on Sui blockchain.

⚠️ **IMPORTANT: This tool does NOT execute trades automatically.**

## What It Does

- Monitors your Cetus CLMM position health
- Checks if current price is within position range
- Calculates price deviation when out of range
- Suggests optimal rebalancing ranges
- Alerts when deviation exceeds threshold
- Logs all data for manual review

## What It Does NOT Do

- ❌ Does not execute rebalancing transactions
- ❌ Does not swap tokens
- ❌ Does not add/remove liquidity
- ❌ Does not modify your position

## Why Monitoring Only?

Safe automated rebalancing requires:

1. **Proper coin object selection and handling** - Complex wallet coin management
2. **Real slippage calculations** - Based on actual pool reserves and depth
3. **Atomic transaction sequencing** - Remove → swap → add without partial failures
4. **MEV protection** - Price impact analysis and sandwich attack prevention
5. **Decimal precision handling** - Proper scaling for different token decimals

Rather than implementing these features unsafely, this tool provides monitoring
so you can manually execute rebalancing when needed.

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env`:

```bash
# Required
PRIVATE_KEY=0x...          # For wallet address only (no transactions executed)
POOL_ID=0x...             # Cetus pool to monitor
POSITION_ID=0x...         # Your position NFT ID

# Optional
RPC_URL=https://fullnode.mainnet.sui.io:443
CHECK_INTERVAL_MS=60000   # Check every 60 seconds
REBALANCE_THRESHOLD_PERCENT=2.0  # Alert threshold
RANGE_WIDTH_PERCENT=5.0   # Suggested range width
```

## Usage

```bash
# Build
npm run build

# Run
npm start
```

The bot will:
1. Check position every 60 seconds (configurable)
2. Log current state and health
3. Alert if deviation exceeds threshold
4. Suggest optimal rebalancing ranges

## Output Example

```
=== Position Monitor Report ===
Pool: 0x...
Position: 0x...
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
Manual rebalancing recommended
```

## Manual Rebalancing

When the monitor alerts you:

1. Review the suggested range
2. Use Cetus UI or SDK to:
   - Remove liquidity from old position
   - Close old position
   - Create new position with suggested range
   - Add liquidity

## Project Structure

```
src/
├── config/           # Environment validation
├── services/
│   ├── bot.ts           # Main monitoring orchestrator
│   ├── cetusService.ts  # Pool/position data fetching
│   ├── suiClient.ts     # Sui RPC client
│   └── monitorService.ts # Position monitoring logic
├── utils/
│   ├── logger.ts        # Winston logging
│   ├── retry.ts         # Exponential backoff
│   └── tickMath.ts      # CLMM calculations
└── types/           # TypeScript interfaces
```

## Safety Features

✅ Read-only operations  
✅ No transaction execution  
✅ Validated tick math  
✅ Proper bounds checking  
✅ No unsafe type conversions  
✅ Comprehensive error handling  

## Technical Details

- Uses Cetus SDK for pool/position data
- Proper CLMM tick mathematics (Uniswap V3 compatible)
- Price-based range calculations (not tick-based)
- Tick spacing validation
- Bounds checking on all calculations

## License

ISC

## Failure Scenarios & Atomic Design

This tool is monitoring-only by design. For documentation on why automated rebalancing was removed and how it could be implemented safely, see:

- **[FAILURE_SCENARIOS.md](FAILURE_SCENARIOS.md)** - Comprehensive analysis of all failure cases (swap fails, partial execution, gas spikes, price movement) and why non-atomic operations are unsafe
- **[ATOMIC_REBALANCING_DESIGN.md](ATOMIC_REBALANCING_DESIGN.md)** - Complete design for safe implementation using Sui's Programmable Transaction Blocks (PTB)

### Key Insights

**Problem**: Multi-transaction rebalancing has inherent risks:
- Swap can fail after liquidity removed (stuck with no position)
- Gas can spike mid-execution (partial completion)
- Price can move between operations (stale calculations)
- MEV attacks can extract value (front-running/sandwiching)

**Solution**: Atomic PTB execution:
- All operations in single transaction
- All succeed or all fail (no partial state)
- Automatic rollback on failure
- Single gas estimation
- MEV resistant

**Status**: Design complete, implementation requires extensive testing, coin handling logic, and security audit.
