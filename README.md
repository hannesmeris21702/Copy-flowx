# Cetus CLMM Position Scanner

A simple tool for scanning Cetus Protocol CLMM positions on the Sui blockchain.

## Features

- Connect to your Sui wallet
- Scan for all CLMM position NFTs in your wallet
- Display positions with active liquidity
- Read-only operations - **no transactions executed**

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
# Required: Your wallet private key (0x-prefixed, 64 hex chars)
PRIVATE_KEY=0x...

# Optional: Sui RPC URL (default: mainnet)
RPC_URL=https://fullnode.mainnet.sui.io:443

# Optional: Network (default: mainnet)
NETWORK=mainnet
```

## Usage

Build and run the scanner:

```bash
npm run build
npm start
```

The scanner will:
1. Connect to your wallet
2. Search for all CLMM position NFTs
3. Display positions with active liquidity
4. Exit cleanly

## Example Output

### No positions found:
```
=== Cetus CLMM Position Scanner ===
This tool scans your wallet for CLMM positions with liquidity
No transactions will be executed
Loading configuration...
Validating configuration...
Configuration loaded successfully
Sui client initialized with RPC: https://fullnode.mainnet.sui.io:443
Wallet address: 0x...
Cetus SDK initialized
=== Scanning Wallet for CLMM Positions ===
✓ No CLMM positions found in wallet
  Your wallet does not contain any position NFTs
=== Scan Complete ===
```

### Positions found:
```
=== Cetus CLMM Position Scanner ===
This tool scans your wallet for CLMM positions with liquidity
No transactions will be executed
...
=== Scanning Wallet for CLMM Positions ===
Found 2 position NFT(s) in wallet
Checking positions for liquidity...

✓ Found 2 position(s) with active liquidity:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Position ID: 0xabc123...
Pool ID:     0xdef456...
Liquidity:   1500000
Coin A:      0x2::sui::SUI
Coin B:      0xtoken::usdc::USDC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Position ID: 0xghi789...
Pool ID:     0xjkl012...
Liquidity:   2500000
Coin A:      0x2::sui::SUI
Coin B:      0xtoken::usdt::USDT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

=== Scan Complete ===
```

## Testing

Run the test suite:

```bash
npm test
```

The tests verify:
- ✓ Wallet with 0 positions → scanner exits cleanly
- ✓ Wallet with 1 position → scanner logs position details
- ✓ Wallet with multiple positions → scanner logs all positions
- ✓ Positions with 0 liquidity → scanner ignores them

## Project Structure

```
src/
├── config/              # Configuration loading and validation
├── services/
│   ├── positionScanner.ts  # Main scanner logic
│   └── suiClient.ts        # Sui blockchain client
├── utils/
│   ├── logger.ts           # Logging
│   ├── retry.ts            # Retry logic for RPC calls
│   ├── sentry.ts           # Error tracking
│   └── debugMode.ts        # Debug utilities
└── types/               # TypeScript interfaces
```

## Safety

This tool is completely safe:
- ✅ Read-only operations
- ✅ No transaction execution
- ✅ No gas spending
- ✅ Zero risk to your funds

## Requirements

- Node.js >= 18.0.0
- A Sui wallet with a private key

## License

ISC
