# Atomic Rebalancing Implementation Design

## Overview

This document provides a complete design for implementing safe atomic rebalancing using Sui's Programmable Transaction Blocks (PTB). This is **design documentation only** - not actual implementation.

## Architecture

```
AtomicRebalanceService
├── Pre-execution validation
├── PTB construction
├── Simulation
├── Execution
└── Post-execution verification
```

## Core Principles

1. **Single Transaction**: All operations in one PTB
2. **Validation First**: Check everything before building PTB
3. **Simulate Always**: Dry run before real execution
4. **Fail Fast**: Abort on any validation failure
5. **No Partial State**: All-or-nothing execution

---

## Component Design

### 1. Coin Handler

**Purpose**: Select and prepare coins for transaction

```typescript
interface CoinHandler {
  // Get all coins of a type owned by address
  getCoins(coinType: string, owner: string): Promise<CoinObject[]>;
  
  // Select optimal coins for amount needed
  selectCoins(coins: CoinObject[], amountNeeded: bigint): CoinObject[];
  
  // Calculate if we have enough coins
  hasEnoughCoins(coinType: string, amount: bigint): Promise<boolean>;
  
  // Build merge operations for PTB
  buildMergeOperations(ptb: Transaction, coins: CoinObject[]): TransactionArgument;
}
```

**Implementation Notes:**
- Query coins via `client.getCoins()`
- Sort by balance (largest first for efficiency)
- Select minimum number of coins needed
- Add merge operations to PTB if multiple coins
- Handle coin decimals properly

---

### 2. Slippage Calculator

**Purpose**: Calculate real minimum amounts based on pool state

```typescript
interface SlippageCalculator {
  // Calculate expected amounts from liquidity removal
  calculateExpectedAmounts(
    pool: Pool,
    position: Position,
    liquidity: bigint
  ): Promise<{ amountA: bigint; amountB: bigint }>;
  
  // Apply slippage tolerance
  applySlippage(
    amount: bigint,
    slippagePercent: number
  ): bigint;
  
  // Calculate minimum amounts for PTB
  getMinimumAmounts(
    pool: Pool,
    position: Position,
    slippageTolerance: number
  ): Promise<{ minA: bigint; minB: bigint }>;
}
```

**Formula:**
```typescript
// For position with liquidity L, tickLower, tickUpper
// At current sqrt price P:

if (currentTick < tickLower) {
  // All token A
  amountA = L * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper) * Q64
  amountB = 0
} else if (currentTick > tickUpper) {
  // All token B
  amountA = 0
  amountB = L * (sqrtUpper - sqrtLower) / Q64
} else {
  // Both tokens
  amountA = L * (sqrtUpper - sqrtPrice) / (sqrtPrice * sqrtUpper) * Q64
  amountB = L * (sqrtPrice - sqrtLower) / Q64
}

minA = amountA * (100 - slippagePercent) / 100
minB = amountB * (100 - slippagePercent) / 100
```

---

### 3. Price Impact Analyzer

**Purpose**: Calculate price impact of swaps

```typescript
interface PriceImpactAnalyzer {
  // Get pool reserves
  getReserves(pool: Pool): Promise<{ reserveA: bigint; reserveB: bigint }>;
  
  // Calculate price impact of trade
  calculateImpact(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint,
    feeRate: number
  ): number; // Returns percentage
  
  // Check if impact is acceptable
  isAcceptableImpact(impact: number, maxImpact: number): boolean;
}
```

**Formula (Constant Product AMM):**
```typescript
// Uniswap V3 / Cetus uses concentrated liquidity, but for large swaps:
// impact ≈ amountIn / reserveIn * 100

const amountInWithFee = amountIn * (10000 - feeRate) / 10000;
const amountOut = (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
const expectedAmountOut = amountIn * reserveOut / reserveIn;
const priceImpact = (expectedAmountOut - amountOut) / expectedAmountOut * 100;
```

---

### 4. Gas Estimator

**Purpose**: Estimate total gas for PTB

```typescript
interface GasEstimator {
  // Estimate gas for PTB
  estimateGas(ptb: Transaction): Promise<bigint>;
  
  // Check if gas is within budget
  isGasAcceptable(estimated: bigint, maxGas: bigint): boolean;
  
  // Get current gas price
  getCurrentGasPrice(): Promise<bigint>;
}
```

**Implementation:**
```typescript
// Use simulation to get gas estimate
const dryRun = await client.dryRunTransactionBlock({
  transactionBlock: await ptb.build({ client })
});

const gasUsed = BigInt(dryRun.effects.gasUsed.computationCost) +
                BigInt(dryRun.effects.gasUsed.storageCost);

// Add safety margin (20%)
const estimatedGas = gasUsed * 120n / 100n;
```

---

### 5. PTB Builder

**Purpose**: Construct atomic rebalancing PTB

```typescript
interface PTBBuilder {
  buildRebalancePTB(
    pool: Pool,
    position: Position,
    newRange: { tickLower: number; tickUpper: number },
    coins: { coinA: CoinObject[]; coinB: CoinObject[] },
    slippage: { minA: bigint; minB: bigint }
  ): Transaction;
}
```

**Implementation:**
```typescript
buildRebalancePTB(params) {
  const ptb = new Transaction();
  
  // 1. Remove liquidity from old position
  const [removedA, removedB] = ptb.moveCall({
    target: `${pkg}::pool_script::remove_liquidity`,
    arguments: [
      ptb.object(globalConfig),
      ptb.object(params.pool.id),
      ptb.object(params.position.id),
      ptb.pure.u128(params.position.liquidity),
      ptb.pure.u64(params.slippage.minA),
      ptb.pure.u64(params.slippage.minB),
      ptb.object(SUI_CLOCK_OBJECT_ID),
    ],
    typeArguments: [params.pool.coinTypeA, params.pool.coinTypeB],
  });
  
  // 2. Collect fees
  const [feeA, feeB] = ptb.moveCall({
    target: `${pkg}::pool_script::collect_fee`,
    arguments: [
      ptb.object(globalConfig),
      ptb.object(params.pool.id),
      ptb.object(params.position.id),
      ptb.pure.bool(true),
    ],
    typeArguments: [params.pool.coinTypeA, params.pool.coinTypeB],
  });
  
  // 3. Merge removed liquidity with fees
  const totalA = ptb.mergeCoins(removedA, [feeA]);
  const totalB = ptb.mergeCoins(removedB, [feeB]);
  
  // 4. Close old position
  ptb.moveCall({
    target: `${pkg}::pool_script::close_position`,
    arguments: [
      ptb.object(globalConfig),
      ptb.object(params.pool.id),
      ptb.object(params.position.id),
    ],
    typeArguments: [params.pool.coinTypeA, params.pool.coinTypeB],
  });
  
  // 5. Swap if needed (calculate optimal ratio for new range)
  const optimalRatio = calculateOptimalRatio(
    params.pool.currentSqrtPrice,
    params.newRange.tickLower,
    params.newRange.tickUpper
  );
  
  const [balancedA, balancedB] = swapToOptimalRatio(
    ptb,
    totalA,
    totalB,
    optimalRatio
  );
  
  // 6. Open new position with balanced coins
  const tickLowerAbs = Math.abs(params.newRange.tickLower);
  const tickUpperAbs = Math.abs(params.newRange.tickUpper);
  const isLowerNeg = params.newRange.tickLower < 0;
  const isUpperNeg = params.newRange.tickUpper < 0;
  
  const newPosition = ptb.moveCall({
    target: `${pkg}::pool_script::open_position`,
    arguments: [
      ptb.object(globalConfig),
      ptb.object(params.pool.id),
      ptb.pure.u32(tickLowerAbs),
      ptb.pure.bool(isLowerNeg),
      ptb.pure.u32(tickUpperAbs),
      ptb.pure.bool(isUpperNeg),
      ptb.object(SUI_CLOCK_OBJECT_ID),
    ],
    typeArguments: [params.pool.coinTypeA, params.pool.coinTypeB],
  });
  
  // 7. Add liquidity to new position
  ptb.moveCall({
    target: `${pkg}::pool_script::add_liquidity`,
    arguments: [
      ptb.object(globalConfig),
      ptb.object(params.pool.id),
      newPosition,
      balancedA,
      balancedB,
      ptb.pure.u64(minAddA), // Calculated minimum
      ptb.pure.u64(minAddB), // Calculated minimum
      ptb.object(SUI_CLOCK_OBJECT_ID),
    ],
    typeArguments: [params.pool.coinTypeA, params.pool.coinTypeB],
  });
  
  // 8. Transfer new position to user
  ptb.transferObjects([newPosition], ptb.pure.address(user));
  
  return ptb;
}
```

---

### 6. Simulator

**Purpose**: Simulate PTB before execution

```typescript
interface Simulator {
  simulate(ptb: Transaction): Promise<SimulationResult>;
  validateSimulation(result: SimulationResult): void;
  extractOutputAmounts(result: SimulationResult): OutputAmounts;
}

interface SimulationResult {
  status: 'success' | 'failure';
  error?: string;
  gasUsed: bigint;
  outputs: any[];
  events: any[];
}
```

**Implementation:**
```typescript
async simulate(ptb: Transaction): Promise<SimulationResult> {
  const txBytes = await ptb.build({ client: this.client });
  
  const dryRun = await this.client.dryRunTransactionBlock({
    transactionBlock: txBytes,
  });
  
  if (dryRun.effects.status.status !== 'success') {
    throw new Error(`Simulation failed: ${dryRun.effects.status.error}`);
  }
  
  return {
    status: 'success',
    gasUsed: BigInt(dryRun.effects.gasUsed.computationCost),
    outputs: parseOutputs(dryRun),
    events: dryRun.events,
  };
}
```

---

### 7. Executor

**Purpose**: Execute PTB with safety checks

```typescript
interface Executor {
  execute(ptb: Transaction): Promise<ExecutionResult>;
  waitForConfirmation(digest: string): Promise<void>;
  verifyResult(result: ExecutionResult): void;
}
```

**Implementation:**
```typescript
async execute(ptb: Transaction): Promise<ExecutionResult> {
  // Final pre-execution check
  await this.validateBeforeExecution();
  
  // Execute
  const result = await this.client.signAndExecuteTransaction({
    transaction: ptb,
    signer: this.keypair,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  });
  
  // Verify success
  if (result.effects?.status.status !== 'success') {
    throw new Error(`Execution failed: ${result.effects?.status.error}`);
  }
  
  // Wait for finalization
  await this.waitForFinalization(result.digest);
  
  return result;
}
```

---

## Complete Workflow

```typescript
class AtomicRebalanceService {
  async rebalance(
    pool: Pool,
    position: Position,
    newRange: { tickLower: number; tickUpper: number }
  ): Promise<void> {
    // Phase 1: Pre-execution validation
    logger.info('Phase 1: Validation');
    
    const gasPrice = await this.gasEstimator.getCurrentGasPrice();
    if (gasPrice > this.config.maxGasPrice) {
      throw new Error('Gas price too high');
    }
    
    const poolState = await this.cetusService.getPool();
    const positionState = await this.cetusService.getPosition();
    
    // Phase 2: Calculate parameters
    logger.info('Phase 2: Calculation');
    
    const expectedAmounts = await this.slippageCalc.calculateExpectedAmounts(
      poolState,
      positionState,
      BigInt(positionState.liquidity)
    );
    
    const minAmounts = this.slippageCalc.applySlippage(
      expectedAmounts,
      this.config.maxSlippagePercent
    );
    
    // Phase 3: Prepare coins
    logger.info('Phase 3: Coin preparation');
    
    const coinsA = await this.coinHandler.getCoins(pool.coinTypeA, this.address);
    const coinsB = await this.coinHandler.getCoins(pool.coinTypeB, this.address);
    
    // Phase 4: Build PTB
    logger.info('Phase 4: PTB construction');
    
    const ptb = this.ptbBuilder.buildRebalancePTB({
      pool: poolState,
      position: positionState,
      newRange,
      coins: { coinA: coinsA, coinB: coinsB },
      slippage: minAmounts,
    });
    
    // Phase 5: Simulate
    logger.info('Phase 5: Simulation');
    
    const simResult = await this.simulator.simulate(ptb);
    this.simulator.validateSimulation(simResult);
    
    const estimatedGas = simResult.gasUsed;
    if (!this.gasEstimator.isGasAcceptable(estimatedGas, this.config.maxGas)) {
      throw new Error('Estimated gas exceeds maximum');
    }
    
    // Phase 6: Price impact check
    logger.info('Phase 6: Price impact check');
    
    const outputs = this.simulator.extractOutputAmounts(simResult);
    const priceImpact = this.priceImpactAnalyzer.calculateImpact(
      outputs.swapAmount,
      poolState.reserveA,
      poolState.reserveB,
      poolState.feeRate
    );
    
    if (!this.priceImpactAnalyzer.isAcceptableImpact(
      priceImpact,
      this.config.maxPriceImpact
    )) {
      throw new Error(`Price impact ${priceImpact}% too high`);
    }
    
    // Phase 7: Execute atomically
    logger.info('Phase 7: Atomic execution');
    
    const result = await this.executor.execute(ptb);
    
    // Phase 8: Verify
    logger.info('Phase 8: Verification');
    
    this.executor.verifyResult(result);
    
    logger.info('Rebalance completed successfully');
  }
}
```

---

## Error Handling

```typescript
async rebalanceWithErrorHandling() {
  try {
    await this.rebalance(pool, position, newRange);
  } catch (error) {
    if (error.message.includes('slippage')) {
      logger.error('Slippage too high, increase tolerance or retry');
      // Position unchanged - safe to retry
    } else if (error.message.includes('gas')) {
      logger.error('Gas issue, wait for lower gas prices');
      // Position unchanged - safe to retry
    } else if (error.message.includes('price impact')) {
      logger.error('Price impact too high, wait for better conditions');
      // Position unchanged - safe to retry
    } else {
      logger.error('Unexpected error', error);
      // Position unchanged - transaction reverted
    }
    
    // In ALL cases: position is unchanged because PTB is atomic
    // No partial state possible
    // No cleanup needed
  }
}
```

---

## Testing Strategy

### 1. Unit Tests
- Test each component independently
- Mock external dependencies
- Validate calculations

### 2. Integration Tests
- Test complete workflow on testnet
- Use real Cetus pools
- Test with real coins

### 3. Failure Tests
- Simulate each failure scenario
- Verify atomic rollback
- Ensure no partial state

### 4. Stress Tests
- High gas prices
- Large price movements
- Low liquidity pools
- MEV attempts

---

## Deployment Checklist

- [ ] Implement all components
- [ ] Unit test coverage > 90%
- [ ] Integration tests pass on testnet
- [ ] Failure scenarios tested
- [ ] Gas estimation accurate
- [ ] Slippage calculations verified
- [ ] Price impact checks working
- [ ] Simulate before execute always
- [ ] Security audit completed
- [ ] Documentation complete
- [ ] Monitoring/alerting setup
- [ ] Rollback plan documented

---

## Why This Is Not Implemented Yet

This design is **complete and correct**, but implementation requires:

1. **Extensive Testing**: Weeks of testnet testing
2. **Security Audit**: Professional security review
3. **Complex Coin Logic**: Wallet integration for coin selection
4. **Edge Cases**: Handle all pool states, tick configurations
5. **Gas Optimization**: PTB can be complex, needs optimization
6. **Error Recovery**: Comprehensive error handling
7. **User Experience**: Clear feedback on simulation results

**Current decision**: Monitoring-only is safer until resources available for proper implementation.

This document serves as the blueprint when ready to implement.
