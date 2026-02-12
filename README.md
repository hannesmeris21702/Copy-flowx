# CLMM Position Rebalancer

Automated rebalancing bot for Concentrated Liquidity Market Maker (CLMM) positions on Sui blockchain. This bot monitors and automatically rebalances liquidity positions to maintain optimal price ranges and maximize yield.

## Features

- **Protocol Support**: Works with Cetus CLMM (extensible to Turbos and KriyaDEX)
- **Automated Rebalancing**: Continuously monitors positions and rebalances when price moves outside target ranges
- **Reward Compounding**: Automatically compounds rewards based on configurable thresholds and schedules
- **Modular Architecture**: Production-grade layered architecture (SDK, Monitor, Engine, Execution, Risk)
- **Price Impact Protection**: Configurable price impact thresholds to prevent unfavorable trades
- **Risk Management**: Slippage checks, cooldown guards, volatility protection
- **Strategy Presets**: Pre-configured SAFE and AGGRESSIVE modes
- **Flexible Configuration**: Environment-based configuration for different trading strategies
- **Built-in Logging**: Comprehensive logging system for monitoring bot activities
- **Event Monitoring**: Detects large swaps and can trigger position adjustments

## Modular Architecture

This bot uses a production-grade modular architecture with clear separation of concerns:

```
src/
  sdk/          - Sui client and protocol SDK initialization
  monitor/      - Pool, position, and event monitoring
  engine/       - Strategy logic, range calculation, value preservation
  execution/    - Granular Move call functions (remove liquidity, collect fees, swap, open position)
  risk/         - Safety guards (slippage, price impact, cooldown, volatility)
  utils/        - Utilities and helpers
  Worker.ts     - Main orchestrator
  index.ts      - Entry point
```

For detailed architecture documentation, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Architecture

The bot consists of several key layers:

- **SDK Layer**: Unified interface to Sui blockchain and CLMM protocols
- **Monitor Layer**: Pool watcher, position watcher, event listener
- **Engine Layer**: Strategy logic, range calculator, value preservation
- **Execution Layer**: Granular Move call functions for each operation
- **Risk Layer**: Safety guards (slippage, price impact, cooldown, volatility)
- **Worker**: Main orchestrator that manages the rebalancing process
- **PositionManager**: Handles position creation, closing, and management
- **Pool Providers**: Interface with different CLMM protocols
- **Price Providers**: Aggregate price data from Pyth oracle
- **Transaction Executor**: Manages Sui blockchain transactions with caching

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed documentation.

## How It Works

### Core Rebalancing Logic

The CLMM position rebalancer operates on a continuous monitoring loop that evaluates whether current liquidity positions need to be adjusted based on price movements. Here's the detailed workflow:

#### 1. Position Monitoring

The bot continuously monitors:

- **Current Pool Price**: Real-time price from the target liquidity pool
- **Position Range**: Current active liquidity range (lower and upper price bounds)
- **Price Deviation**: How far the current price has moved from the position center

#### 2. Rebalancing Triggers

The bot triggers a rebalance when:

- **Out of Range**: Current price moves outside the active liquidity range
- **Range Drift**: Price moves significantly within range but position becomes inefficient
- **Scheduled Rebalancing**: Time-based triggers for proactive management

#### 3. Reward Compounding Logic

##### Threshold Evaluation

The bot compounds rewards when either condition is met:

- **Time Condition**: `current_time - last_compound_time >= COMPOUND_REWARDS_SCHEDULE_MS`
- **Value Condition**: `reward_value_usd >= REWARD_THRESHOLD_USD`

##### Reward Value Calculation

```
Reward Value USD = Σ(reward_token_amount × token_price_usd)
```

The bot aggregates all claimable rewards across different tokens and converts to USD value.

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd clmm-position-rebalancer
```

2. Install dependencies:

```bash
yarn install
```

3. Build the project:

```bash
yarn build
```

## Configuration

Create a `.env` file in the root directory based on `.env.example`.

### Strategy Modes

The bot supports two pre-configured strategy modes:

#### SAFE Mode (Default)
Conservative parameters for stable, low-risk operation:
- Wider price range (5%)
- Strict slippage tolerance (1%)
- Longer cooldown between rebalances (1 hour)
- Lower volatility tolerance (10%)
- Higher reward threshold ($10)

#### AGGRESSIVE Mode
Active parameters for maximizing yield with higher risk:
- Tighter price range (2%)
- Higher slippage tolerance (5%)
- Shorter cooldown (10 minutes)
- Higher volatility tolerance (20%)
- Lower reward threshold ($1)

### Configuration Options

```env
# Protocol to use (CETUS for Cetus CLMM)
PROTOCOL=CETUS

# Strategy mode: SAFE or AGGRESSIVE
STRATEGY_MODE=SAFE

# Target pool ID for rebalancing (Cetus pool object ID)
TARGET_POOL=0x...

# Private key for the wallet (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# Price range percentages (in basis points, 10000 = 100%)
BPRICE_PERCENT=50                     # Bottom price % (0.5%)
TPRICE_PERCENT=10                     # Top price % (0.1%)

# Slippage tolerance (in basis points)
SLIPPAGE_TOLERANCE=50000              # 5%

# Price impact threshold (in basis points)
PRICE_IMPACT_PERCENT_THRESHOLD=-5000  # -0.5%

# Minimum amounts for operations
MIN_ZAP_AMOUNT_X=1000000
MIN_ZAP_AMOUNT_Y=1000000

# Position size multiplier
MULTIPLIER=1

# Reward compounding
REWARD_THRESHOLD_USD=1                # Minimum USD value to compound
COMPOUND_REWARDS_SCHEDULE_MS=3600000  # 1 hour

# Risk management
REBALANCE_COOLDOWN_MS=3600000         # 1 hour cooldown between rebalances
MAX_VOLATILITY_PERCENT=1000           # 10% max volatility

# Event monitoring
LARGE_SWAP_THRESHOLD_USD=100000       # $100k threshold for large swaps
```

### Optional Configuration

```env
# Reward threshold in USD before compounding
REWARD_THRESHOLD_USD=10

# Address for tracking volume (optional)
TRACKING_VOLUME_ADDRESS=0x...

# Rebalance retry attempts
REBALANCE_RETRIES=3

# RPC endpoint (defaults to Sui mainnet)
JSON_RPC_ENDPOINT=https://fullnode.mainnet.sui.io:443

# Log level (debug, info, warn, error)
LOG_LEVEL=info
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed configuration and usage examples.

## Usage

### Running the Bot

Start the rebalancing bot:

```bash
node dist/index.js
```

The bot will:

1. Initialize with the provided configuration
2. Monitor the target pool for price movements
3. Automatically rebalance positions when price moves outside the configured range
4. Compound rewards based on the schedule and threshold settings

### Testing

Run the test suite:

```bash
yarn test
```

## Key Concepts

### Price Range Strategy

The bot maintains liquidity positions within a target price range:

- **BPRICE_PERCENT**: Bottom price percentage below current price
- **TPRICE_PERCENT**: Top price percentage above current price

When the current price moves outside this range, the bot automatically rebalances by:

1. Closing the current position
2. Collecting any available rewards
3. Opening a new position centered around the current price

### Reward Compounding

The bot can automatically compound rewards based on:

- **Time Schedule**: Compound rewards at regular intervals
- **USD Threshold**: Only compound when rewards exceed a minimum USD value

### Risk Management

- **Slippage Protection**: Configurable slippage tolerance for all trades
- **Price Impact Limits**: Prevents trades with excessive price impact
- **Minimum Amounts**: Ensures positions meet minimum liquidity requirements

## Supported Protocols

- **Cetus CLMM**: Concentrated liquidity market maker on Sui blockchain



## Monitoring and Logging

The bot includes comprehensive logging to track:

- Position rebalancing events
- Reward compounding activities
- Price movements and range violations
- Transaction successes and failures
- Performance metrics
