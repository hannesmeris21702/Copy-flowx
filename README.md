# CLMM Position Rebalancer

Automated rebalancing bot for Concentrated Liquidity Market Maker (CLMM) positions on Sui blockchain. This bot monitors and automatically rebalances liquidity positions to maintain optimal price ranges and maximize yield.

## Features

- **Protocol Support**: Works with FlowX V3, 
- **Automated Rebalancing**: Continuously monitors positions and rebalances when price moves outside target ranges
- **Reward Compounding**: Automatically compounds rewards based on configurable thresholds and schedules
- **Price Impact Protection**: Configurable price impact thresholds to prevent unfavorable trades
- **Flexible Configuration**: Environment-based configuration for different trading strategies
- **Built-in Logging**: Comprehensive logging system for monitoring bot activities
- **Caching**: Intelligent caching mechanisms for better performance

## Architecture

The bot consists of several key components:

- **Worker**: Main orchestrator that manages the rebalancing process
- **PositionManager**: Handles position creation, closing, and management
- **Pool Providers**: Interface with different CLMM protocols
- **Price Providers**: Aggregate price data from multiple sources (Pyth, FlowX, etc.)
- **Transaction Executor**: Manages Sui blockchain transactions with caching

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

Create a `.env` file in the root directory with the following variables:

### Required Configuration

```env
# Protocol to use FLOWX_V3
PROTOCOL=FLOWX_V3

# Target pool ID for rebalancing
TARGET_POOL=0x...

# Private key for the wallet (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# Price range percentages (in basis points, e.g., 500 = 0.05%)
BPRICE_PERCENT=500
TPRICE_PERCENT=500

# Slippage tolerance (in basis points)
SLIPPAGE_TOLERANCE=100

# Price impact threshold (in basis points)
PRICE_IMPACT_PERCENT_THRESHOLD=300

# Minimum amounts for zapping
MIN_ZAP_AMOUNT_X=1000000
MIN_ZAP_AMOUNT_Y=1000000

# Position size multiplier
MULTIPLIER=1

# Reward compounding schedule (in milliseconds)
COMPOUND_REWARDS_SCHEDULE_MS=3600000
```

### Optional Configuration

```env
# Reward threshold in USD before compounding
REWARD_THRESHOLD_USD=10

# Address for tracking volume (optional)
TRACKING_VOLUME_ADDRESS=0x...

# Rebalance retry attempts
REBALANCE_RETRIES=3
```

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

- **FlowX V3**: Next-generation AMM with concentrated liquidity



## Monitoring and Logging

The bot includes comprehensive logging to track:

- Position rebalancing events
- Reward compounding activities
- Price movements and range violations
- Transaction successes and failures
- Performance metrics
