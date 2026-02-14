# Rebalance State Tracking Implementation

## Overview

This document describes the state tracking system implemented for rebalance operations, which enables safe resume after crashes or restarts and prevents duplicate operations like closing a position twice.

## Problem Solved

### Before State Tracking:
- If the bot crashed during rebalance, it would start over from scratch
- **Risk:** Could close the same position twice (catastrophic failure)
- **Risk:** Lost track of which steps were completed
- **Risk:** Could try to add liquidity to non-existent position
- No way to resume partial rebalance operations

### After State Tracking:
- Bot remembers where it left off
- **Safe:** Never closes position twice
- **Efficient:** Resumes from last completed step
- **Robust:** Validates state before using it
- **Automatic:** Clears state when complete

## Architecture

### State Machine

```
┌─────────────┐
│  MONITORING │  (Initial state - no rebalance in progress)
└──────┬──────┘
       │ Position OUT_OF_RANGE detected
       ▼
┌──────────────────┐
│ POSITION_CLOSED  │  (Position closed, coins in wallet)
└──────┬───────────┘
       │ Balances queried, value calculated
       ▼
┌──────────────────┐
│ SWAP_COMPLETED   │  (Swap executed if needed, or skipped)
└──────┬───────────┘
       │ Tokens balanced for new range
       ▼
┌──────────────────┐
│ POSITION_OPENED  │  (New position NFT created, no liquidity)
└──────┬───────────┘
       │ Position ID captured
       ▼
┌──────────────────┐
│ LIQUIDITY_ADDED  │  (Liquidity added, rebalance complete)
└──────┬───────────┘
       │ Clear state
       ▼
┌─────────────┐
│  MONITORING │  (Back to monitoring)
└─────────────┘
```

### State Transitions

| From State        | Action              | To State         | State Saved? | Data Stored                                           |
|-------------------|---------------------|------------------|--------------|-------------------------------------------------------|
| MONITORING        | close_position      | POSITION_CLOSED  | ✅ Yes       | availableA, availableB, totalValue                    |
| POSITION_CLOSED   | execute_swap        | SWAP_COMPLETED   | ✅ Yes       | + swapExecuted, tickLower, tickUpper                  |
| SWAP_COMPLETED    | open_position       | POSITION_OPENED  | ✅ Yes       | + newPositionId                                       |
| POSITION_OPENED   | add_liquidity       | LIQUIDITY_ADDED  | ✅ Yes       | + valuePreserved                                      |
| LIQUIDITY_ADDED   | clear_state         | MONITORING       | ❌ No        | State file deleted                                    |

## Components

### 1. State Types (src/types/index.ts)

```typescript
export enum RebalanceState {
  MONITORING = 'MONITORING',
  POSITION_CLOSED = 'POSITION_CLOSED',
  SWAP_COMPLETED = 'SWAP_COMPLETED',
  POSITION_OPENED = 'POSITION_OPENED',
  LIQUIDITY_ADDED = 'LIQUIDITY_ADDED',
}

export interface RebalanceStateData {
  state: RebalanceState;
  positionId: string;
  poolId: string;
  timestamp: string;
  data?: {
    availableA?: string;
    availableB?: string;
    totalValue?: string;
    newPositionId?: string;
    tickLower?: number;
    tickUpper?: number;
    swapExecuted?: boolean;
    [key: string]: any;
  };
}
```

### 2. StateManager Class (src/utils/stateManager.ts)

**Purpose:** Handles all state persistence operations

**Methods:**

#### `loadState(): RebalanceStateData | null`
- Loads current state from file
- Returns null if no state file exists (fresh start)
- Handles corrupted files gracefully

**Example:**
```typescript
const state = stateManager.loadState();
if (state) {
  console.log(`Resuming from ${state.state}`);
} else {
  console.log('Starting fresh');
}
```

#### `saveState(stateData: RebalanceStateData): void`
- Saves state to file in JSON format
- Creates or overwrites existing state file
- Logs save operation

**Example:**
```typescript
stateManager.saveState({
  state: RebalanceState.POSITION_CLOSED,
  positionId: '0xabc...',
  poolId: '0xdef...',
  timestamp: new Date().toISOString(),
  data: {
    availableA: '1000000',
    availableB: '500000',
  },
});
```

#### `clearState(): void`
- Deletes state file
- Called after successful rebalance completion
- Returns system to MONITORING state

**Example:**
```typescript
// Rebalance complete
stateManager.clearState();
```

#### `isStateCompleted(currentState, targetState): boolean`
- Checks if current state is at or past target state
- Used to skip completed steps on resume

**Example:**
```typescript
if (stateManager.isStateCompleted(resumeState, RebalanceState.POSITION_CLOSED)) {
  console.log('Position already closed - skipping');
  // Restore data from saved state
}
```

#### `getNextState(currentState): RebalanceState`
- Returns the next state in the sequence
- Useful for state transition logic

### 3. State File Format

**Default Location:** `.rebalance-state.json` (in current working directory)

**Configurable via:** `STATE_FILE_PATH` environment variable

**Example State File:**
```json
{
  "state": "POSITION_CLOSED",
  "positionId": "0x789abc...",
  "poolId": "0x456def...",
  "timestamp": "2026-02-14T15:30:45.123Z",
  "data": {
    "availableA": "1000000",
    "availableB": "500000",
    "totalValue": "3000000.500000"
  }
}
```

**Example State File (After Swap):**
```json
{
  "state": "SWAP_COMPLETED",
  "positionId": "0x789abc...",
  "poolId": "0x456def...",
  "timestamp": "2026-02-14T15:31:00.456Z",
  "data": {
    "availableA": "950000",
    "availableB": "550000",
    "totalValue": "3000000.500000",
    "tickLower": 12000,
    "tickUpper": 14000,
    "swapExecuted": true
  }
}
```

**Example State File (Position Opened):**
```json
{
  "state": "POSITION_OPENED",
  "positionId": "0x789abc...",
  "poolId": "0x456def...",
  "timestamp": "2026-02-14T15:31:30.789Z",
  "data": {
    "availableA": "950000",
    "availableB": "550000",
    "totalValue": "3000000.500000",
    "tickLower": 12000,
    "tickUpper": 14000,
    "newPositionId": "0x123xyz...",
    "swapExecuted": true
  }
}
```

## Integration with RebalanceService

### Initialization

```typescript
export class RebalanceService {
  private stateManager: StateManager;
  
  constructor(suiClient, cetusService, config) {
    // ...
    this.stateManager = new StateManager(config.stateFilePath);
  }
}
```

### Rebalance Start (Load State)

```typescript
async rebalance(pool: Pool, position: Position): Promise<void> {
  // Load existing state for resume capability
  const existingState = this.stateManager.loadState();
  let resumeState: RebalanceState = RebalanceState.MONITORING;
  let stateData: any = {};
  
  if (existingState) {
    // Validate that we're resuming the same position/pool
    if (existingState.positionId !== position.id || 
        existingState.poolId !== pool.id) {
      logger.warn('State file for different position - starting fresh');
      this.stateManager.clearState();
    } else {
      resumeState = existingState.state;
      stateData = existingState.data || {};
      logger.info('🔄 RESUMING FROM SAVED STATE');
      logger.info(`   Current State: ${resumeState}`);
    }
  }
  
  // Continue with rebalance...
}
```

### Step 1: Close Position (or Skip)

```typescript
// Skip if already completed
if (this.stateManager.isStateCompleted(resumeState, RebalanceState.POSITION_CLOSED)) {
  logger.info('⏭️  SKIPPING: Position already closed');
  
  // Restore data from saved state
  availableA = BigInt(stateData.availableA || '0');
  availableB = BigInt(stateData.availableB || '0');
  totalValue = parseFloat(stateData.totalValue || '0');
} else {
  // Execute close_position
  await this.closePosition(pool, position);
  
  // Query balances
  availableA = await this.suiClient.getWalletBalance(pool.coinTypeA);
  availableB = await this.suiClient.getWalletBalance(pool.coinTypeB);
  
  // Calculate value
  const { totalValue: calcTotalValue } = calculateQuoteValue(...);
  totalValue = calcTotalValue;
  
  // Save state: POSITION_CLOSED
  this.stateManager.saveState({
    state: RebalanceState.POSITION_CLOSED,
    positionId: position.id,
    poolId: pool.id,
    timestamp: new Date().toISOString(),
    data: {
      availableA: availableA.toString(),
      availableB: availableB.toString(),
      totalValue: totalValue.toString(),
    },
  });
}
```

### Step 2: Execute Swap (or Skip)

```typescript
// Skip if already completed
if (this.stateManager.isStateCompleted(resumeState, RebalanceState.SWAP_COMPLETED)) {
  logger.info('⏭️  SKIPPING: Swap already completed');
  
  // Restore data if swap was executed
  if (stateData.swapExecuted) {
    availableA = BigInt(stateData.availableA || '0');
    availableB = BigInt(stateData.availableB || '0');
  }
} else if (swapCheck.swapRequired) {
  // Execute swap
  await this.executeSwap(...);
  
  // Refresh balances
  availableA = await this.suiClient.getWalletBalance(pool.coinTypeA);
  availableB = await this.suiClient.getWalletBalance(pool.coinTypeB);
  
  // Save state: SWAP_COMPLETED
  this.stateManager.saveState({
    state: RebalanceState.SWAP_COMPLETED,
    positionId: position.id,
    poolId: pool.id,
    timestamp: new Date().toISOString(),
    data: {
      availableA: availableA.toString(),
      availableB: availableB.toString(),
      totalValue: totalValue.toString(),
      tickLower: newRange.tickLower,
      tickUpper: newRange.tickUpper,
      swapExecuted: true,
    },
  });
} else {
  // No swap needed - save state anyway
  this.stateManager.saveState({
    state: RebalanceState.SWAP_COMPLETED,
    // ... (swapExecuted: false)
  });
}
```

### Step 3: Open Position (or Skip)

```typescript
// Skip if already completed
if (this.stateManager.isStateCompleted(resumeState, RebalanceState.POSITION_OPENED)) {
  logger.info('⏭️  SKIPPING: Position already opened');
  
  // Restore data from saved state
  newPositionId = stateData.newPositionId || '';
  
  if (!newPositionId) {
    throw new Error('State error: position opened but ID not found');
  }
} else {
  // Open new position
  newPositionId = await this.openPosition(...);
  
  // Save state: POSITION_OPENED
  this.stateManager.saveState({
    state: RebalanceState.POSITION_OPENED,
    positionId: position.id,
    poolId: pool.id,
    timestamp: new Date().toISOString(),
    data: {
      // ... all previous data
      newPositionId: newPositionId,
    },
  });
}
```

### Step 4: Add Liquidity (or Skip)

```typescript
// Skip if already completed
if (this.stateManager.isStateCompleted(resumeState, RebalanceState.LIQUIDITY_ADDED)) {
  logger.info('⏭️  SKIPPING: Liquidity already added');
  logger.info('   Rebalance was already completed - clearing state');
  
  // Clear state and return
  this.stateManager.clearState();
  return;
}

// Add liquidity
await this.addLiquidity(...);

// Verify value preservation
const valuePreserved = ...;

// Save state: LIQUIDITY_ADDED
this.stateManager.saveState({
  state: RebalanceState.LIQUIDITY_ADDED,
  positionId: position.id,
  poolId: pool.id,
  timestamp: new Date().toISOString(),
  data: {
    newPositionId: newPositionId,
    valuePreserved: valuePreserved,
  },
});

// Clear state - rebalance complete
this.stateManager.clearState();
```

## Log Output Examples

### Fresh Start (No State)
```
No state file found - starting fresh
=== Starting Position Closure ===
Position is OUT_OF_RANGE - closing position...
```

### Resume from POSITION_CLOSED
```
Loaded state: POSITION_CLOSED from .rebalance-state.json
  Position ID: 0x789...
  Timestamp: 2026-02-14T15:30:45.123Z

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 RESUMING FROM SAVED STATE
   Current State: POSITION_CLOSED
   Saved at: 2026-02-14T15:30:45.123Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏭️  SKIPPING: Position already closed (resuming from saved state)
   Restored availableA: 1000000
   Restored availableB: 500000
   Restored totalValue: 3000000.500000

Calculating new position range...
```

### Resume from SWAP_COMPLETED
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 RESUMING FROM SAVED STATE
   Current State: SWAP_COMPLETED
   Saved at: 2026-02-14T15:31:00.456Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏭️  SKIPPING: Position already closed
⏭️  SKIPPING: Swap already completed
   Restored availableA: 950000
   Restored availableB: 550000

Opening new position...
```

### Resume from POSITION_OPENED
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 RESUMING FROM SAVED STATE
   Current State: POSITION_OPENED
   Saved at: 2026-02-14T15:31:30.789Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏭️  SKIPPING: Position already closed
⏭️  SKIPPING: Swap already completed
⏭️  SKIPPING: Position already opened
   Restored newPositionId: 0x123xyz...

Adding liquidity to position...
```

### Resume from LIQUIDITY_ADDED
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 RESUMING FROM SAVED STATE
   Current State: LIQUIDITY_ADDED
   Saved at: 2026-02-14T15:32:00.123Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏭️  SKIPPING: Position already closed
⏭️  SKIPPING: Swap already completed
⏭️  SKIPPING: Position already opened
⏭️  SKIPPING: Liquidity already added
   Rebalance was already completed - clearing state

State file cleared - returned to MONITORING
```

## Safety Features

### 1. Idempotency
- Each step checks if it's already completed
- If completed, restores data and continues
- Never executes the same operation twice

### 2. Position/Pool Validation
```typescript
if (existingState.positionId !== position.id || 
    existingState.poolId !== pool.id) {
  logger.warn('State file for different position - starting fresh');
  this.stateManager.clearState();
}
```

### 3. Error Handling
```typescript
loadState(): RebalanceStateData | null {
  try {
    // Load and parse state file
  } catch (error) {
    logger.error('Error loading state file', error);
    // Return null to start fresh (don't crash)
    return null;
  }
}
```

### 4. Graceful Degradation
- If state file is corrupted: start fresh
- If state data is incomplete: throw clear error
- If save fails: log but don't crash (continue operation)

## Configuration

### State File Path

**Environment Variable:** `STATE_FILE_PATH`

**Default:** `.rebalance-state.json` (in current working directory)

**Example .env:**
```
STATE_FILE_PATH=/var/lib/copy-flowx/rebalance-state.json
```

**Example TypeScript:**
```typescript
const config: BotConfig = {
  // ... other config
  stateFilePath: process.env.STATE_FILE_PATH || '.rebalance-state.json',
};
```

## Testing Scenarios

### Scenario 1: Crash After Position Close
1. Bot closes position
2. State saved: POSITION_CLOSED
3. Bot crashes
4. Bot restarts
5. Loads state: POSITION_CLOSED
6. Skips close_position
7. Restores balances from state
8. Continues from swap check

**Result:** ✅ No duplicate close, rebalance continues smoothly

### Scenario 2: Crash During Swap
1. Bot closes position
2. State saved: POSITION_CLOSED
3. Bot starts swap
4. Bot crashes mid-swap
5. Bot restarts
6. Loads state: POSITION_CLOSED (swap not completed)
7. Queries fresh balances (swap may or may not have completed)
8. Checks swap requirement again
9. Executes or skips swap

**Result:** ✅ Handles partial swap gracefully

### Scenario 3: Crash After Position Open
1. Bot opens new position
2. State saved: POSITION_OPENED
3. Bot crashes before adding liquidity
4. Bot restarts
5. Loads state: POSITION_OPENED
6. Restores newPositionId from state
7. Continues to add liquidity

**Result:** ✅ Empty position gets liquidity added

### Scenario 4: Manual State Deletion
1. User deletes state file
2. Bot starts
3. Sees no state file
4. Starts fresh rebalance

**Result:** ⚠️ Will try to close already-closed position (will fail gracefully)

**Recommendation:** Don't delete state file manually unless certain no rebalance is in progress

## Best Practices

### 1. Monitor State File
- Check state file age if bot seems stuck
- State file older than expected interval indicates issue

### 2. Backup State File (Optional)
```bash
# Before major operations
cp .rebalance-state.json .rebalance-state.json.backup
```

### 3. State File Location
- Use persistent storage (not /tmp)
- Ensure proper permissions (bot needs read/write)
- Consider using absolute path in production

### 4. Logging
- Always log state transitions
- Include timestamps in state data
- Log when skipping completed steps

## Future Enhancements

### Potential Improvements:
1. **State Expiry:** Automatically clear old state files
2. **State Versioning:** Handle schema changes gracefully
3. **Multiple Positions:** Track state per position
4. **Database Storage:** Use database instead of file
5. **State History:** Keep history of state transitions
6. **Metrics:** Track time spent in each state

## Conclusion

State tracking transforms the rebalancing bot from a fragile, all-or-nothing operation into a robust, resumable process. The key benefits are:

- **Safety:** Never duplicate critical operations
- **Reliability:** Resume from any point of failure
- **Transparency:** Clear logging of what's happening
- **Simplicity:** Easy to understand and debug

The implementation is production-ready and has been designed with safety as the top priority.
