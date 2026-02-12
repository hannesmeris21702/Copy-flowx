# Failure Scenario Analysis & Atomic Rebalancing Design

## Current State

This codebase is a **monitoring-only tool**. All rebalancing functionality was removed because it could not be implemented safely. This document analyzes what **would** go wrong with unsafe implementations and provides a blueprint for safe implementation.

## Failure Scenarios Analysis

### Scenario 1: Swap Fails

**Non-Atomic Approach (UNSAFE):**
```typescript
// Step 1: Remove liquidity - SUCCEEDS
await removeLiquidity(position);  // ✓ Liquidity withdrawn, coins in wallet

// Step 2: Swap tokens - FAILS
await swap(coinA, coinB);  // ✗ Swap reverts (slippage/MEV/liquidity)

// Step 3: Add liquidity - NEVER EXECUTED
await addLiquidity(newRange);
```

**RESULT:**
- ❌ Position closed, liquidity removed
- ❌ Coins sitting in wallet (not earning fees)
- ❌ No position protection
- ❌ Full price exposure
- ❌ Manual intervention required

**Impact:** Complete loss of position, manual recovery needed, potential price exposure losses.

---

### Scenario 2: Remove Succeeds, Add Fails

**Non-Atomic Approach (UNSAFE):**
```typescript
// Step 1: Remove liquidity - SUCCEEDS
await removeLiquidity(position);  // ✓ Old position closed

// Step 2: Collect fees - SUCCEEDS
await collectFees(position);  // ✓ Fees collected

// Step 3: Close position - SUCCEEDS
await closePosition(position);  // ✓ Position NFT burned

// Step 4: Calculate new range - SUCCEEDS
const newRange = calculateRange();  // ✓ Math succeeds

// Step 5: Add liquidity - FAILS
await addLiquidity(newRange);  // ✗ Fails (insufficient coins/gas/price moved)
```

**RESULT:**
- ❌ Old position destroyed
- ❌ New position never created
- ❌ All liquidity sitting idle
- ❌ Zero fee generation
- ❌ Complete rebalancing failure

**Impact:** Worst case - no position at all, maximum recovery complexity, potential significant losses.

---

### Scenario 3: Gas Spike Mid-Execution

**Non-Atomic Approach (UNSAFE):**
```typescript
// Transaction 1: Remove liquidity
tx1.gasPrice = 1000 MIST;  // Low gas when starting
await execute(tx1);  // ✓ SUCCEEDS

// Gas market changes
// New gas price: 50000 MIST (50x spike!)

// Transaction 2: Add liquidity
tx2.gasPrice = 50000 MIST;  // High gas now
await execute(tx2);  // ✗ FAILS - insufficient gas budget
```

**RESULT:**
- ❌ First transaction succeeded
- ❌ Second transaction rejected (gas too high)
- ❌ Partial state (removed but not added)
- ❌ User pays gas for failed operation

**Impact:** Stuck in intermediate state, wasted gas, position unprotected.

---

### Scenario 4: Price Moves During Rebalance

**Non-Atomic Approach (UNSAFE):**
```typescript
// Time T0: Check price
const currentTick = 12000;
const newRange = calculateRange(12000);  // [11500, 12500]

// Time T1: Remove liquidity (takes 2 seconds)
await removeLiquidity();  // ✓ Succeeds

// Time T2: Price moves significantly
// New tick: 13000 (moved 1000 ticks up!)

// Time T3: Add liquidity with OLD range
await addLiquidity(newRange);  // ✓ Succeeds but range is now wrong!
```

**RESULT:**
- ❌ Position created at wrong range
- ❌ Immediately out of range
- ❌ No fee generation
- ❌ Needs immediate re-rebalance
- ❌ Wasted gas on useless operation

**Impact:** Ineffective rebalance, position immediately out of range, wasted gas, no protection.

---

### Scenario 5: Slippage/MEV Attack

**Non-Atomic Approach (UNSAFE):**
```typescript
await removeLiquidity(position, minAmount='1');  // Fake slippage protection

// MEV bot detects transaction
// Bot front-runs with large trade
// Price moves against user
// Bot back-runs to restore price

// User receives: 1 coinA, 1 coinB (instead of expected 1000 / 1000)
```

**RESULT:**
- ❌ Lost 99.9% of value to slippage
- ❌ Insufficient coins to recreate position
- ❌ Sandwich attack extracted value

**Impact:** Massive value loss, position cannot be recreated, victim of MEV.

---

## Root Cause: Non-Atomic Operations

All scenarios share the same root cause: **Multiple separate transactions without atomicity**.

### Problems with Multi-Transaction Approach:

1. **No Rollback**
   - If step N fails, steps 1..N-1 are committed
   - Cannot undo previous operations
   - Leaves partial state

2. **No Atomicity**
   - Each transaction is independent
   - No all-or-nothing guarantee
   - Intermediate states are visible on-chain

3. **Price Oracle Lag**
   - Price checked at T0
   - Operations execute at T1, T2, T3...
   - Price may change between operations

4. **Gas Estimation Issues**
   - Each transaction estimated separately
   - Total gas unknown until execution
   - May run out of gas mid-workflow

5. **MEV Vulnerability**
   - Each transaction visible in mempool
   - Bots can front-run/sandwich
   - Value extraction possible

---

## Solution: Atomic Programmable Transaction Blocks (PTB)

Sui supports **Programmable Transaction Blocks** which execute atomically: all operations succeed or all fail.

### Atomic Rebalancing Design

```typescript
// Single atomic transaction
const ptb = new Transaction();

// Step 1: Remove liquidity
const [coinA, coinB] = ptb.moveCall({
  target: 'pool_script::remove_liquidity',
  arguments: [pool, position, liquidity, minA, minB, clock],
});

// Step 2: Collect fees (add to coins)
const [feeA, feeB] = ptb.moveCall({
  target: 'pool_script::collect_fee',
  arguments: [pool, position],
});

// Step 3: Merge coins
const totalA = ptb.mergeCoins(coinA, [feeA]);
const totalB = ptb.mergeCoins(coinB, [feeB]);

// Step 4: Close old position
ptb.moveCall({
  target: 'pool_script::close_position',
  arguments: [pool, position],
});

// Step 5: Swap if needed (using return values from above)
const [swappedA, swappedB] = ptb.moveCall({
  target: 'pool_script::swap',
  arguments: [pool, totalA, totalB, ...],
});

// Step 6: Open new position (using swapped coins)
const newPosition = ptb.moveCall({
  target: 'pool_script::open_position',
  arguments: [pool, tickLower, tickUpper, swappedA, swappedB, clock],
});

// Step 7: Transfer new position to user
ptb.transferObjects([newPosition], user);

// Execute atomically - ALL or NOTHING
await client.signAndExecuteTransaction({ transaction: ptb });
```

### Benefits of PTB Approach:

✅ **Atomicity**: All operations succeed or all fail (no partial state)
✅ **Single Gas Estimate**: One transaction, one gas calculation
✅ **Immediate Execution**: No time for price to move between steps
✅ **MEV Protection**: Less vulnerable (all-or-nothing, harder to sandwich)
✅ **Automatic Rollback**: If any step fails, entire transaction reverts
✅ **Coin Flow**: Coins flow directly between operations (no wallet intermediate)

---

## Failure Recovery in PTB

### With PTB, Failures Are Clean:

**Scenario 1: Swap Fails in PTB**
```typescript
// ALL operations in single transaction
const ptb = buildRebalancePTB();
await execute(ptb);  // ✗ Swap fails, ENTIRE transaction reverts
```

**RESULT:**
✅ Position unchanged (remove never happened)
✅ No partial state
✅ Can retry with adjusted parameters

**Scenario 2: Add Fails in PTB**
```typescript
await execute(ptb);  // ✗ Add fails, ENTIRE transaction reverts
```

**RESULT:**
✅ Position unchanged
✅ Remove was never committed
✅ Clean failure

**Scenario 3: Gas Spike in PTB**
```typescript
const gasEstimate = await client.dryRun(ptb);  // Estimate TOTAL gas
if (gasEstimate > MAX_GAS) {
  throw new Error('Gas too high, aborting');
}
await execute(ptb);  // Single transaction with correct gas
```

**RESULT:**
✅ Single gas check before execution
✅ No partial execution possible

**Scenario 4: Price Movement in PTB**
```typescript
// Price checked INSIDE transaction via pool state
// All operations use SAME pool state
// No time for price to move between operations
```

**RESULT:**
✅ Consistent price view
✅ Range calculated from actual execution price
✅ No stale data

---

## Implementation Requirements for Safe PTB

### 1. Pre-Execution Validation

```typescript
// Before building PTB
const checks = {
  gasPrice: await checkGasPrice(),
  poolState: await getPoolState(),
  positionState: await getPositionState(),
  coinBalances: await getCoinBalances(),
  slippageLimits: calculateSlippage(poolState),
};

if (checks.gasPrice > MAX_GAS) {
  throw new Error('Gas too high');
}

if (checks.slippageLimits.priceImpact > MAX_IMPACT) {
  throw new Error('Price impact too high');
}
```

### 2. Simulation Before Execution

```typescript
const ptb = buildRebalancePTB(checks);

// Simulate to check for failures
const simResult = await client.dryRunTransactionBlock({
  transactionBlock: await ptb.build({ client }),
});

if (simResult.effects.status.status !== 'success') {
  throw new Error(`Simulation failed: ${simResult.effects.status.error}`);
}

// Extract expected outputs from simulation
const expectedOutputs = parseSimulationOutputs(simResult);

// Validate outputs meet requirements
if (!validateOutputs(expectedOutputs)) {
  throw new Error('Output validation failed');
}
```

### 3. Slippage Protection

```typescript
// Calculate REAL minimum amounts from pool state
const poolReserves = await getPoolReserves(pool);
const currentPrice = await getPoolPrice(pool);

const expectedAmounts = calculateExpectedAmounts(
  liquidity,
  tickLower,
  tickUpper,
  currentPrice
);

// Apply slippage tolerance
const minAmountA = expectedAmounts.amountA * (1 - SLIPPAGE_PERCENT / 100);
const minAmountB = expectedAmounts.amountB * (1 - SLIPPAGE_PERCENT / 100);

// Use in PTB
ptb.moveCall({
  target: 'remove_liquidity',
  arguments: [..., minAmountA, minAmountB, ...],
});
```

### 4. Price Impact Check

```typescript
// Check price impact of swap
const swapImpact = calculatePriceImpact(
  swapAmount,
  poolReserves,
  feeRate
);

if (swapImpact > MAX_PRICE_IMPACT) {
  throw new Error(`Price impact ${swapImpact}% exceeds maximum ${MAX_PRICE_IMPACT}%`);
}
```

### 5. Timeout Protection

```typescript
const MAX_EXECUTION_TIME = 30_000; // 30 seconds

const executeWithTimeout = Promise.race([
  execute(ptb),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Execution timeout')), MAX_EXECUTION_TIME)
  ),
]);
```

---

## Comparison: Multi-TX vs PTB

| Aspect | Multi-Transaction (UNSAFE) | PTB (SAFE) |
|--------|---------------------------|------------|
| Atomicity | ❌ No | ✅ Yes |
| Partial State | ❌ Possible | ✅ Impossible |
| Rollback | ❌ Manual | ✅ Automatic |
| Gas Estimation | ❌ Per-tx | ✅ Total |
| Price Consistency | ❌ Can change | ✅ Consistent |
| MEV Vulnerability | ❌ High | ✅ Lower |
| Failure Recovery | ❌ Complex | ✅ Clean |
| Implementation | ❌ Complex | ✅ Straightforward |

---

## Monitoring-Only Tool Decision

This codebase remains **monitoring-only** because:

1. **PTB Implementation Requires:**
   - Proper coin object selection from wallet
   - Complex coin merging/splitting logic
   - Accurate pool reserve queries
   - Real-time price impact calculations
   - Comprehensive testing on testnet
   - Security audit

2. **Risk vs Benefit:**
   - Half-implemented = High risk
   - Monitoring = Zero risk
   - Monitoring still provides value (alerts + suggestions)

3. **User Safety:**
   - Users can manually rebalance via Cetus UI
   - UI has proper coin handling
   - UI has tested slippage protection
   - UI has been audited

---

## Conclusion

**All failure scenarios share one root cause: non-atomic operations.**

**The solution is PTB, but safe implementation requires:**
- Proper coin handling
- Real slippage calculations
- Price impact checks
- Comprehensive simulation
- Extensive testing

**Until these can be implemented properly, monitoring-only is the responsible choice.**

This document serves as a blueprint for future implementation when resources and expertise are available for safe atomic rebalancing.
