# Architecture Visual Overview

## High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER / OPERATOR                           │
│                   (Configuration via .env)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ENTRY POINT                                 │
│                      src/index.ts                                │
│  - Load configuration                                            │
│  - Initialize Worker                                             │
│  - Start monitoring loop                                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR                                 │
│                     src/Worker.ts                                │
│  - Continuous monitoring loop (5s interval)                      │
│  - Coordinate all layers                                         │
│  - Execute rebalancing workflow                                  │
└─────┬────────────────────────────────────────────────────┬──────┘
      │                                                     │
      ▼                                                     ▼
┌─────────────────────────────────┐      ┌──────────────────────────────┐
│      MONITOR LAYER              │      │     POSITION MANAGER         │
│      src/monitor/               │      │  src/PositionManager.ts      │
│  ┌──────────────────────────┐  │      │  - Migrate positions         │
│  │ PoolWatcher              │  │      │  - Compound rewards          │
│  │ - Pool state monitoring  │  │      │  - Zap calculations          │
│  │ - Tick tracking          │  │      │  - Price impact checks       │
│  └──────────────────────────┘  │      └──────────────────────────────┘
│  ┌──────────────────────────┐  │
│  │ PositionWatcher          │  │
│  │ - Range validation       │  │
│  │ - Liquidity checks       │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │ EventListener            │  │
│  │ - Swap event detection   │  │
│  │ - Large swap alerts      │  │
│  └──────────────────────────┘  │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ENGINE LAYER                                 │
│                     src/engine/                                  │
│  ┌──────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │ Strategy         │  │ RangeCalculator │  │ Value          │ │
│  │ - Rebalance      │  │ - Optimal range │  │ Preservation   │ │
│  │   decisions      │  │ - Tick math     │  │ - USD tracking │ │
│  │ - Cooldown check │  │ - Price ranges  │  │ - Drift checks │ │
│  └──────────────────┘  └─────────────────┘  └────────────────┘ │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     RISK LAYER                                   │
│                     src/risk/                                    │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ SlippageCheck │  │ PriceImpact  │  │ CooldownGuard        │ │
│  │ - Validate    │  │ Check        │  │ - Time enforcement   │ │
│  │   slippage    │  │ - USD impact │  │ - Prevent overtrading│ │
│  └───────────────┘  └──────────────┘  └──────────────────────┘ │
│  ┌──────────────────────────────┐                                │
│  │ VolatilityGuard              │                                │
│  │ - Price volatility tracking  │                                │
│  │ - Abnormal market detection  │                                │
│  └──────────────────────────────┘                                │
└─────────────┬───────────────────────────────────────────────────┘
              │ ✅ Safety checks passed
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   EXECUTION LAYER                                │
│                   src/execution/                                 │
│  ┌────────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ removeLiquidity│  │ collectFees │  │ swap                │  │
│  │ - Move call    │  │ - Move call │  │ - Move call         │  │
│  │ - Full removal │  │ - Fees &    │  │ - Simulation first  │  │
│  │                │  │   rewards   │  │ - Safety checks     │  │
│  └────────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌──────────────────────────────┐                                │
│  │ openPosition                 │                                │
│  │ - Move call                  │                                │
│  │ - Mint NFT + Add liquidity   │                                │
│  └──────────────────────────────┘                                │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SDK LAYER                                   │
│                      src/sdk/                                    │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐ │
│  │ suiClient        │  │ cetusSDK                             │ │
│  │ - SuiClient init │  │ - Cetus protocol config              │ │
│  │ - Keypair mgmt   │  │ - Package IDs                        │ │
│  └──────────────────┘  └──────────────────────────────────────┘ │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SUI BLOCKCHAIN                                │
│  - Cetus CLMM Protocol                                           │
│  - Position NFTs                                                 │
│  - Liquidity Pools                                               │
│  - Move smart contracts                                          │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow: Rebalancing Workflow

```
1. DETECT
   ┌──────────────────────────────────────┐
   │ Worker monitors position every 5s    │
   │ ├─ Get pool state (PoolWatcher)      │
   │ ├─ Get position state (PositionWatch)│
   │ └─ Check if in-range                 │
   └───────────┬──────────────────────────┘
               │
               ▼ Out of range detected
2. EVALUATE
   ┌──────────────────────────────────────┐
   │ Strategy evaluates rebalance         │
   │ ├─ Validate position                 │
   │ ├─ Check cooldown (CooldownGuard)    │
   │ ├─ Check volatility (VolatilityGuard)│
   │ └─ Calculate new range               │
   └───────────┬──────────────────────────┘
               │
               ▼ Should rebalance = true
3. CALCULATE
   ┌──────────────────────────────────────┐
   │ RangeCalculator determines new range │
   │ ├─ Center on current tick            │
   │ ├─ Apply bPrice/tPrice %             │
   │ ├─ Validate range contains current   │
   │ └─ Ensure tick spacing alignment     │
   └───────────┬──────────────────────────┘
               │
               ▼ New range calculated
4. EXECUTE (Transaction)
   ┌──────────────────────────────────────┐
   │ PositionManager.migrate()            │
   │                                       │
   │ Step 1: removeLiquidity              │
   │    └─ Move call to remove_liquidity  │
   │                                       │
   │ Step 2: collectFees                  │
   │    └─ Move call to collect_fee       │
   │                                       │
   │ Step 3: collectRewards               │
   │    └─ Move call to collect_reward    │
   │                                       │
   │ Step 4: closePosition                │
   │    └─ Move call to close_position    │
   │                                       │
   │ Step 5: calculateZap (if needed)     │
   │    ├─ Determine token imbalance      │
   │    └─ Calculate swap amounts         │
   │                                       │
   │ Step 6: swap (if imbalance)          │
   │    ├─ simulateSwap                   │
   │    ├─ SlippageCheck.check            │
   │    ├─ PriceImpactCheck.check         │
   │    └─ Move call to swap_a2b/swap_b2a │
   │                                       │
   │ Step 7: openPosition                 │
   │    ├─ Move call to mint              │
   │    └─ Move call to open_position     │
   │                                       │
   └───────────┬──────────────────────────┘
               │
               ▼ Transaction executed
5. VERIFY
   ┌──────────────────────────────────────┐
   │ Verify new position                  │
   │ ├─ Check new position exists         │
   │ ├─ Validate tick range               │
   │ ├─ Verify liquidity > 0              │
   │ ├─ ValuePreservation.check (USD)     │
   │ └─ Record rebalance timestamp        │
   └───────────┬──────────────────────────┘
               │
               ▼ Success ✅
   ┌──────────────────────────────────────┐
   │ Continue monitoring                  │
   │ - New position now being tracked     │
   │ - Cooldown period active             │
   │ - Resume normal operation            │
   └──────────────────────────────────────┘
```

## Safety Guard Flow

```
┌───────────────────────────────────────┐
│ Operation Request                     │
└───────────┬───────────────────────────┘
            │
            ▼
┌───────────────────────────────────────┐
│ 1. CooldownGuard                      │
│    Is cooldown period satisfied?      │
└───────────┬───────────────────────────┘
            │ ✅ Yes
            ▼
┌───────────────────────────────────────┐
│ 2. VolatilityGuard                    │
│    Is market volatility acceptable?   │
└───────────┬───────────────────────────┘
            │ ✅ Yes
            ▼
┌───────────────────────────────────────┐
│ 3. Simulate Operation                 │
│    Calculate expected output          │
└───────────┬───────────────────────────┘
            │
            ▼
┌───────────────────────────────────────┐
│ 4. SlippageCheck                      │
│    Is slippage within tolerance?      │
└───────────┬───────────────────────────┘
            │ ✅ Yes
            ▼
┌───────────────────────────────────────┐
│ 5. PriceImpactCheck                   │
│    Is price impact acceptable?        │
└───────────┬───────────────────────────┘
            │ ✅ Yes
            ▼
┌───────────────────────────────────────┐
│ 6. ValuePreservation (post-execution) │
│    Is total USD value maintained?     │
└───────────┬───────────────────────────┘
            │ ✅ Yes
            ▼
┌───────────────────────────────────────┐
│ Operation Complete ✅                 │
│ - All safety checks passed            │
│ - Value preserved                     │
│ - Ready for next operation            │
└───────────────────────────────────────┘

Legend:
  ❌ = Operation aborted
  ✅ = Check passed, continue
```

## Module Dependency Graph

```
index.ts
  └─ Worker.ts
       ├─ Monitor Layer
       │   ├─ PoolWatcher
       │   ├─ PositionWatcher
       │   └─ EventListener
       │
       ├─ PositionManager
       │   ├─ Engine Layer
       │   │   ├─ Strategy
       │   │   ├─ RangeCalculator
       │   │   └─ ValuePreservation
       │   │
       │   ├─ Risk Layer
       │   │   ├─ SlippageCheck
       │   │   ├─ PriceImpactCheck
       │   │   ├─ CooldownGuard
       │   │   └─ VolatilityGuard
       │   │
       │   └─ Execution Layer
       │       ├─ removeLiquidity
       │       ├─ collectFees
       │       ├─ swap
       │       └─ openPosition
       │
       └─ SDK Layer
           ├─ suiClient
           └─ cetusSDK

Entities (Supporting)
  ├─ Pool Providers
  ├─ Position Providers
  └─ Price Providers

Utils (Shared)
  ├─ tickMath
  ├─ tokenHelper
  ├─ Logger
  └─ ... (other utilities)
```

## Configuration Flow

```
.env file
  │
  ├─ STRATEGY_MODE ────────────┐
  ├─ BPRICE_PERCENT            │
  ├─ TPRICE_PERCENT            │
  ├─ SLIPPAGE_TOLERANCE        │
  ├─ REBALANCE_COOLDOWN_MS     │
  └─ ... (other params)        │
                               │
                               ▼
              ┌────────────────────────────────┐
              │ src/config/strategyPresets.ts  │
              │                                │
              │ SAFE_MODE_CONFIG               │
              │ - Conservative parameters      │
              │                                │
              │ AGGRESSIVE_MODE_CONFIG         │
              │ - Active parameters            │
              └────────────┬───────────────────┘
                           │
                           ▼
              ┌────────────────────────────────┐
              │ src/index.ts                   │
              │ - Parse environment variables  │
              │ - Apply strategy preset        │
              │ - Override with custom values  │
              │ - Initialize Worker            │
              └────────────┬───────────────────┘
                           │
                           ▼
              ┌────────────────────────────────┐
              │ Worker Configuration           │
              │ - All layers initialized       │
              │ - Ready for operation          │
              └────────────────────────────────┘
```

## Transaction Construction Flow

```
Worker.executeRebalance()
  │
  ▼
  new Transaction()  ←─── Sui SDK
  │
  ├─ Step 1: removeLiquidity(position, tx)
  │   └─ tx.moveCall({
  │       target: "clmm::pool::remove_liquidity",
  │       arguments: [config, pool, position, ...],
  │     })
  │
  ├─ Step 2: collectFees(position, tx)
  │   └─ tx.moveCall({
  │       target: "clmm::pool::collect_fee",
  │       arguments: [config, pool, position],
  │     })
  │
  ├─ Step 3: collectAllRewards(position, tx)
  │   └─ tx.moveCall({
  │       target: "clmm::pool::collect_reward",
  │       arguments: [config, pool, position, vault, ...],
  │     })
  │
  ├─ Step 4: executeSwap(params, coinIn, tx)  [if needed]
  │   └─ tx.moveCall({
  │       target: "clmm::pool::swap_a2b", // or swap_b2a
  │       arguments: [config, pool, coinIn, ...],
  │     })
  │
  └─ Step 5: openPosition(params, coinX, coinY, tx)
      ├─ tx.moveCall({
      │    target: "clmm::position::mint",
      │    arguments: [poolsId],
      │  })
      └─ tx.moveCall({
           target: "clmm::pool::open_position",
           arguments: [config, pool, position, ticks, coins, ...],
         })
  │
  ▼
  client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair
  })
  │
  ▼
  Sui Blockchain
```

This architecture provides:
- ✅ Clear separation of concerns
- ✅ Easy to test each layer independently
- ✅ Easy to extend (add new protocols, strategies, guards)
- ✅ Production-ready with comprehensive safety
- ✅ Type-safe throughout
- ✅ Well-documented and maintainable
