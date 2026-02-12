# Project Summary: Cetus CLMM Position Monitor

## Current State: Monitoring-Only Tool

This is a **production-ready monitoring tool** that tracks Cetus CLMM positions on Sui. It does **not** execute any transactions.

## What It Does

✅ Monitors position health every 60 seconds
✅ Checks if price is within position range
✅ Calculates price deviation when out of range
✅ Suggests optimal rebalancing ranges (ICT-style)
✅ Alerts when deviation exceeds threshold
✅ Logs comprehensive reports
✅ Safe read-only operations only

## Documentation

### Core Documents

1. **README.md** - User guide, installation, usage
2. **STRUCTURAL_REVIEW.md** - Why rebalancing was removed
3. **FAILURE_SCENARIOS.md** - Analysis of all failure cases
4. **ATOMIC_REBALANCING_DESIGN.md** - Complete implementation blueprint

### Key Insights

**Why Monitoring-Only?**

Automated rebalancing was removed because it could not be implemented safely without:
- Proper coin object handling
- Real slippage calculations from pool state
- Atomic transaction sequencing
- MEV protection mechanisms
- Extensive testing and security audit

**What Would Go Wrong Without PTB?**

All analyzed in FAILURE_SCENARIOS.md:
- Swap fails → liquidity removed but no new position
- Add fails → old position destroyed, no new position
- Gas spikes → partial execution, stuck state
- Price moves → wrong range, immediate failure
- MEV attacks → sandwich attacks extract value

**How to Implement Safely?**

Complete design in ATOMIC_REBALANCING_DESIGN.md:
- Use Sui's Programmable Transaction Blocks (PTB)
- All operations in single atomic transaction
- Pre-execution validation (gas, slippage, price impact)
- Simulation before execution
- Automatic rollback on any failure
- No partial state possible

## Technical Details

### Architecture
```
MonitoringBot
├── SuiClientService (RPC client, read-only)
├── CetusService (Fetch pool/position data)
└── MonitorService (Calculate health, generate reports)
```

### Safe Operations
- Read pool state from Cetus SDK
- Read position state from Cetus SDK
- Calculate position metrics locally
- Log results to console/files
- Zero transaction execution
- Zero gas spending

### Code Quality
- ✅ 807 lines of TypeScript
- ✅ Strict type checking
- ✅ No `any` types
- ✅ No unsafe conversions
- ✅ No placeholders
- ✅ No WARNING comments
- ✅ Proper bounds checking
- ✅ Comprehensive error handling

## Usage

```bash
# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your pool/position IDs

# Build
npm run build

# Run
npm start
```

## When to Rebalance Manually

The monitor will alert when:
- Position goes out of range
- Deviation exceeds threshold (default 2%)
- Suggested new range is calculated

Then manually rebalance via:
1. Cetus UI (recommended - has safety features)
2. Custom implementation following ATOMIC_REBALANCING_DESIGN.md

## Future Implementation Path

If automated rebalancing is to be implemented:

1. **Follow ATOMIC_REBALANCING_DESIGN.md** blueprint
2. **Implement on testnet first**
3. **Test all failure scenarios**
4. **Security audit required**
5. **Comprehensive testing** (weeks minimum)

Do not skip any steps. Half-implementation is worse than no implementation.

## File Structure

```
src/
├── config/           # Environment validation
│   └── index.ts
├── services/
│   ├── bot.ts              # Main monitoring orchestrator
│   ├── cetusService.ts     # Cetus SDK integration (read-only)
│   ├── monitorService.ts   # Position health monitoring
│   └── suiClient.ts        # Sui RPC client
├── utils/
│   ├── logger.ts           # Winston logging
│   ├── retry.ts            # Exponential backoff retry
│   └── tickMath.ts         # CLMM tick calculations
└── types/
    └── index.ts            # TypeScript interfaces

Documentation:
├── README.md                           # User guide
├── STRUCTURAL_REVIEW.md                # Why monitoring-only
├── FAILURE_SCENARIOS.md                # Failure analysis
├── ATOMIC_REBALANCING_DESIGN.md        # Implementation blueprint
└── SUMMARY.md                          # This file
```

## Key Memories

### Sui Transaction Lifecycle
- Transaction objects can only be built once
- Cannot simulate AND execute same Transaction
- Must create separate instances or choose one operation

### BigInt Precision
- Never convert bigint to Number for calculations
- Loses precision for values > 2^53
- Keep as bigint through all operations

### CLMM Tick Math
- Calculate ranges using price percentage, not tick percentage
- Formula: tickDelta = floor(log(1 + p/100) / log(1.0001))
- Ensures range represents actual price movement

### Cetus Position Lifecycle
- Workflow: remove_liquidity → collect_fee → close_position → open_position
- Always close old position before opening new one
- Prevents NFT accumulation

### Atomic Operations
- Use Programmable Transaction Blocks (PTB) for atomicity
- All operations in single transaction
- All succeed or all fail
- No partial state possible

## License

ISC

## Support

This is monitoring-only by design for user safety. For questions about manual rebalancing, consult Cetus documentation or UI.
