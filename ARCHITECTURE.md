# Modular Architecture Documentation

## Overview

This SUI CLMM liquidity management bot follows a modular, layered architecture designed for production-grade operation. Each layer has clear responsibilities and can be independently tested and maintained.

## Architecture Layers

### 1. SDK Layer (`src/sdk/`)

**Purpose**: Provides unified interfaces to interact with the Sui blockchain and CLMM protocols.

**Components**:
- `suiClient.ts` - SuiClient configuration and initialization
- `cetusSDK.ts` - Cetus protocol constants and configuration

**Key Functions**:
```typescript
// Get configured Sui client
const client = getSuiClient();

// Create keypair from private key
const keypair = createKeypair(privateKey);

// Get Cetus configuration
const config = getCetusConfig();
```

### 2. Monitor Layer (`src/monitor/`)

**Purpose**: Monitors pool state, positions, and blockchain events.

**Components**:

#### PoolWatcher
Monitors pool state including current tick, price, and liquidity.

```typescript
const poolWatcher = new PoolWatcher(poolId);
const state = await poolWatcher.getPoolState(pool);
// Returns: { poolId, currentTick, sqrtPriceX64, liquidity, ... }
```

#### PositionWatcher
Monitors position state and determines in-range status.

```typescript
const positionWatcher = new PositionWatcher(positionId);
const isInRange = positionWatcher.isPositionInRange(position);
const isValid = positionWatcher.isValidTickRange(position);
const hasLiquidity = positionWatcher.hasLiquidity(position);
```

#### EventListener
Listens for swap events and detects large swaps.

```typescript
const eventListener = new EventListener(client, poolId, largeSwapThresholdUsd);

eventListener.onSwapEvent((event) => {
  console.log('Large swap detected:', event);
  // Optionally trigger position adjustment
});

eventListener.start();
```

### 3. Engine Layer (`src/engine/`)

**Purpose**: Core strategy logic, range calculations, and value preservation.

**Components**:

#### Strategy
Implements rebalancing strategy and decision logic.

```typescript
const strategy = new Strategy({
  rangePercent: new Percent(500, BPS),
  slippageTolerance: new Percent(100, BPS),
  maxPriceImpact: new Percent(-50, BPS),
  minLiquidity: new BN(100000),
  mode: "SAFE",
  rebalanceCooldownMs: 3600000,
});

const decision = strategy.evaluateRebalance(position);
// Returns: { shouldRebalance, reason, currentTick, tickLower, tickUpper }

if (decision.shouldRebalance) {
  // Execute rebalance
  strategy.recordRebalance(); // Records timestamp for cooldown
}
```

#### RangeCalculator
Calculates optimal tick ranges centered around current price.

```typescript
const rangeCalculator = new RangeCalculator(
  bPricePercent,
  tPricePercent,
  multiplier
);

const range = rangeCalculator.calculateOptimalRange(pool);
// Returns: { tickLower, tickUpper, isValid, reason? }

if (range.isValid) {
  // Use calculated range for new position
}
```

#### ValuePreservation
Ensures total USD value is maintained during rebalancing.

```typescript
const valuePreservation = new ValuePreservation(
  priceProvider,
  maxDriftPercent
);

// Calculate position value
const value = await valuePreservation.calculatePositionValue(position);
// Returns: { tokenXAmount, tokenYAmount, tokenXValueUsd, tokenYValueUsd, totalValueUsd }

// Check value preservation
const check = valuePreservation.checkValuePreservation(
  beforeValueUsd,
  afterValueUsd
);
// Returns: { isWithinTolerance, beforeValueUsd, afterValueUsd, driftPercent, driftAbsolute }

if (!check.isWithinTolerance) {
  // Abort operation - value drift too high
}
```

### 4. Execution Layer (`src/execution/`)

**Purpose**: Granular Move call functions for each CLMM operation.

**Components**:

#### removeLiquidity
Removes liquidity from positions.

```typescript
// Remove all liquidity from position
const [coinX, coinY] = removeLiquidity(position, tx);

// Estimate removal amounts
const { amountX, amountY } = estimateRemovalAmounts(position);
```

#### collectFees
Collects accrued fees and rewards.

```typescript
// Collect fees
const [feeX, feeY] = collectFees(position, tx);

// Collect specific reward
const reward = collectReward(position, tx, rewardIndex);

// Collect all rewards
const rewards = collectAllRewards(position, tx);
```

#### swap
Executes token swaps with safety checks.

```typescript
const swapParams: SwapParams = {
  pool,
  amountIn: new BN(1000000),
  amountOut: new BN(980000),
  isXToY: true,
  slippageTolerance: new Percent(100, BPS),
};

// Simulate swap first
const simulatedOut = await simulateSwap(swapParams);

// Check if should abort
const { shouldAbort, reason } = shouldAbortSwap(swapParams, simulatedOut);

if (!shouldAbort) {
  // Execute swap
  const coinOut = executeSwap(swapParams, coinIn, tx);
}
```

#### openPosition
Opens new CLMM positions.

```typescript
const params: OpenPositionParams = {
  pool,
  tickLower: -1000,
  tickUpper: 1000,
  amountX: new BN(1000000),
  amountY: new BN(2000000),
};

// Validate parameters
const validation = validatePositionParams(params);

if (validation.isValid) {
  // Open position
  const position = openPosition(params, coinX, coinY, tx);
}
```

### 5. Risk Layer (`src/risk/`)

**Purpose**: Safety checks and guards to protect against unfavorable conditions.

**Components**:

#### SlippageCheck
Validates slippage is within acceptable limits.

```typescript
const slippageCheck = new SlippageCheck(
  new Percent(100, BPS) // 1% max slippage
);

const result = slippageCheck.checkSlippage(expectedOut, actualOut);
// Returns: { passed, actualSlippage, maxSlippage, reason? }

if (!result.passed) {
  // Abort operation
}

// Calculate minimum acceptable output
const minOut = slippageCheck.calculateMinOutput(expectedOut);
```

#### PriceImpactCheck
Validates price impact is within acceptable limits.

```typescript
const priceImpactCheck = new PriceImpactCheck(
  new Percent(-50, BPS), // -0.5% max negative impact
  priceProvider
);

const result = await priceImpactCheck.checkPriceImpact(
  tokenInType,
  tokenOutType,
  amountIn,
  amountOut
);
// Returns: { passed, priceImpact, maxPriceImpact, reason? }

if (!result.passed) {
  // Abort swap
}
```

#### CooldownGuard
Enforces minimum time between operations.

```typescript
const cooldownGuard = new CooldownGuard(
  3600000 // 1 hour cooldown
);

const check = cooldownGuard.checkCooldown();
// Returns: { allowed, timeSinceLastMs, cooldownMs, remainingMs?, reason? }

if (check.allowed) {
  // Execute operation
  await executeRebalance();
  
  // Record execution
  cooldownGuard.recordExecution();
}
```

#### VolatilityGuard
Monitors price volatility and blocks operations during high volatility.

```typescript
const volatilityGuard = new VolatilityGuard(
  new Percent(1000, BPS), // 10% max volatility
  300000 // 5 minute window
);

// Record price observations
volatilityGuard.recordPrice(currentPrice);

// Check volatility
const check = volatilityGuard.checkVolatility();
// Returns: { safe, volatility, maxVolatility, reason? }

if (!check.safe) {
  // Skip operation - market too volatile
}
```

## Configuration Presets

The bot includes pre-configured strategy presets:

### SAFE Mode
Conservative parameters for stable, low-risk operation:
- Wider price range (5%)
- Strict slippage tolerance (1%)
- Longer cooldown (1 hour)
- Lower volatility tolerance (10%)

### AGGRESSIVE Mode
Active parameters for maximizing yield:
- Tighter price range (2%)
- Higher slippage tolerance (5%)
- Shorter cooldown (10 minutes)
- Higher volatility tolerance (20%)

```typescript
import { getStrategyConfig, StrategyMode } from './config/strategyPresets';

// Use preset
const config = getStrategyConfig(StrategyMode.SAFE);

// Or create custom
const customConfig = createCustomConfig(StrategyMode.SAFE, {
  rebalanceCooldownMs: 7200000, // 2 hours
});
```

## Integration Example

Complete example of using all layers together:

```typescript
import { getSuiClient, createKeypair } from './sdk';
import { PoolWatcher, PositionWatcher } from './monitor';
import { Strategy, RangeCalculator, ValuePreservation } from './engine';
import { removeLiquidity, collectFees, openPosition } from './execution';
import { SlippageCheck, CooldownGuard, VolatilityGuard } from './risk';

// Initialize
const client = getSuiClient();
const keypair = createKeypair(process.env.PRIVATE_KEY);

// Create components
const poolWatcher = new PoolWatcher(poolId);
const positionWatcher = new PositionWatcher(positionId);
const strategy = new Strategy(strategyConfig);
const cooldownGuard = new CooldownGuard(3600000);
const volatilityGuard = new VolatilityGuard(maxVolatility, 300000);

// Monitor loop
async function monitorAndRebalance() {
  // Get current state
  const pool = await getPool(poolId);
  const position = await getPosition(positionId);
  
  // Monitor
  const poolState = await poolWatcher.getPoolState(pool);
  const positionState = positionWatcher.getPositionState(position);
  
  // Record volatility
  volatilityGuard.recordPrice(new BN(pool.sqrtPriceX64));
  
  // Evaluate strategy
  const decision = strategy.evaluateRebalance(position);
  
  if (!decision.shouldRebalance) {
    return; // No action needed
  }
  
  // Check safety guards
  const cooldownCheck = cooldownGuard.checkCooldown();
  if (!cooldownCheck.allowed) {
    console.log('Cooldown active:', cooldownCheck.reason);
    return;
  }
  
  const volatilityCheck = volatilityGuard.checkVolatility();
  if (!volatilityCheck.safe) {
    console.log('High volatility:', volatilityCheck.reason);
    return;
  }
  
  // Execute rebalance
  const tx = new Transaction();
  
  // 1. Remove liquidity
  const [coinX, coinY] = removeLiquidity(position, tx);
  
  // 2. Collect fees
  const [feeX, feeY] = collectFees(position, tx);
  
  // 3. Calculate new range
  const rangeCalc = new RangeCalculator(bPrice, tPrice, multiplier);
  const newRange = rangeCalc.calculateOptimalRange(pool);
  
  if (!newRange.isValid) {
    console.error('Invalid range:', newRange.reason);
    return;
  }
  
  // 4. Open new position
  const newPosition = openPosition({
    pool,
    tickLower: newRange.tickLower,
    tickUpper: newRange.tickUpper,
    amountX: coinX,
    amountY: coinY,
  }, coinX, coinY, tx);
  
  // 5. Sign and execute
  const result = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
  });
  
  console.log('Rebalance complete:', result.digest);
  
  // Record execution
  cooldownGuard.recordExecution();
  strategy.recordRebalance();
}
```

## Testing

Each layer can be tested independently:

```bash
# Test all layers
yarn test

# Test specific layer
yarn test src/monitor
yarn test src/engine
yarn test src/execution
yarn test src/risk
```

## Safety Features

The modular architecture provides multiple layers of safety:

1. **Input Validation** - All parameters validated before execution
2. **Simulation** - Swaps simulated before execution
3. **Slippage Protection** - Configurable slippage limits
4. **Price Impact Protection** - Prevents unfavorable trades
5. **Cooldown Guards** - Prevents over-trading
6. **Volatility Guards** - Blocks operations during high volatility
7. **Value Preservation** - Ensures total value maintained
8. **Error Handling** - Comprehensive error handling and logging

## Extensibility

The architecture is designed to be easily extended:

- **New Protocols**: Add new protocol SDKs to `src/sdk/`
- **New Strategies**: Implement new strategy logic in `src/engine/`
- **New Monitors**: Add new watchers to `src/monitor/`
- **New Risk Checks**: Add new guards to `src/risk/`
- **New Operations**: Add new execution functions to `src/execution/`

Each layer is loosely coupled and can be modified without affecting other layers.
