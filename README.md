# Cetus CLMM Position Manager

A tool for managing Cetus Protocol CLMM positions on the Sui blockchain with simple zap-based rebalancing.

## Features

### Monitoring Mode (Default - Safe)
- Scans wallet for CLMM position NFTs
- Displays positions with active liquidity
- Read-only operations - **no transactions executed**

### Automated Rebalancing Mode (Advanced)
- **⚠️ Executes transactions automatically**
- Monitors positions for range status (IN_RANGE / OUT_OF_RANGE)
- Simple zap-based rebalancing when positions go out of range
- No custom math or complex calculations
- SDK handles all token swapping and liquidity management

## How Rebalancing Works

When a position goes OUT_OF_RANGE:

1. **Check wallet for positions** with liquidity
2. **For each position**:
   - Check if current price is inside the position range
   - If **IN_RANGE**: Do nothing, continue monitoring
   - If **OUT_OF_RANGE**: Execute rebalance

3. **Rebalance process** (simple zap-based):
   - **Close position**: Remove 100% liquidity, get tokens back
   - **Calculate new range**: Based on current price + configured width
   - **Open new position**: At the new range
   - **Add liquidity**: SDK's zap handles token swapping internally
   - Amount added equals the value from closed position

**No manual calculations or token ratio adjustments - SDK handles everything**

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` and provide your configuration:

```bash
# Required: Your wallet private key
PRIVATE_KEY=0x...

# Optional: Sui RPC URL (default: mainnet)
RPC_URL=https://fullnode.mainnet.sui.io:443

# Optional: Network (default: mainnet)
NETWORK=mainnet

# Optional: Enable automated rebalancing (default: false)
ENABLE_REBALANCING=false

# Optional: Check interval in milliseconds (default: 60000 = 1 minute)
CHECK_INTERVAL_MS=60000

# Optional: Range width in percent (default: 5.0)
RANGE_WIDTH_PERCENT=5.0
```

## Usage

### Monitoring Only (Default - Recommended)

```bash
npm run build
npm start
```

The tool will:
- Scan wallet for positions
- Display positions with liquidity
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
- Monitor positions continuously
- Automatically rebalance when OUT_OF_RANGE
- Use SDK's zap for simple token management
- Log all actions (IN_RANGE / OUT_OF_RANGE / rebalance executed)

## Example Output

### Monitoring Mode:
```
=== Cetus CLMM Position Scanner ===
This tool scans your wallet for CLMM positions with liquidity
No transactions will be executed
...
Found 2 position(s) with active liquidity:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Position ID: 0xabc123...
Pool ID:     0xdef456...
Liquidity:   1500000
Coin A:      0x2::sui::SUI
Coin B:      0xtoken::usdc::USDC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Rebalancing Mode:
```
=== Cetus CLMM Rebalancing Bot ===
⚠️  AUTOMATED REBALANCING ENABLED
⚠️  This bot will execute transactions automatically
...
=== Checking positions ===
Found 1 position(s) with liquidity
Checking position 0xabc123... in pool 0xdef456...
Current tick: 12500, Position range: [10000, 11000]
Position 0xabc123...: OUT_OF_RANGE - Rebalancing...
Step 1: Closing position and removing liquidity...
✓ Position closed successfully
Step 2: Calculating new range...
New range: [12000, 13000]
Step 3: Opening new position...
✓ New position opened
Step 4: Adding liquidity with zap...
✓ New position opened and liquidity added via zap
✅ Rebalance completed successfully
✅ Check completed
```

## Safety Features

### Monitoring Mode
- ✅ Read-only operations
- ✅ No transaction execution
- ✅ No gas spending
- ✅ Zero risk

### Rebalancing Mode
- ✅ Simple zap-based approach (no complex math)
- ✅ SDK handles all token swapping
- ✅ Position-by-position processing
- ✅ Detailed logging of all actions
- ✅ Graceful error handling

## Project Structure

```
src/
├── config/                  # Configuration loading and validation
├── services/
│   ├── positionScanner.ts  # Read-only position scanner
│   ├── rebalancingBot.ts   # Automated rebalancing orchestrator
│   ├── rebalanceService.ts # Simple zap-based rebalance logic
│   ├── cetusService.ts     # Cetus SDK integration
│   └── suiClient.ts        # Sui blockchain client
├── utils/
│   ├── logger.ts           # Logging
│   ├── retry.ts            # Retry logic for RPC calls
│   ├── sentry.ts           # Error tracking
│   └── debugMode.ts        # Debug utilities
└── types/                  # TypeScript interfaces
```

## Testing

Run the test suite:

```bash
npm test
```

## Requirements

- Node.js >= 18.0.0
- A Sui wallet with a private key
- SUI tokens for gas (if using rebalancing mode)

## Important Notes

- **Start with monitoring mode** to understand how the tool works
- **Rebalancing mode executes real transactions** with real funds
- The bot uses SDK's zap functions - no custom calculations
- All token swapping is handled by the SDK internally
- Position NFTs are closed and new ones are created during rebalancing

## License

ISC
