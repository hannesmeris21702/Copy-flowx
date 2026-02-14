# Position Check Logic Update

## Overview
Updated the position check logic to trigger rebalancing based solely on OUT_OF_RANGE status, as specified in the requirements.

## Changes Made

### 1. MonitorService (`src/services/monitorService.ts`)

**Before:**
```typescript
if (!inRange) {
  if (Math.abs(deviation) >= this.config.rebalanceThresholdPercent) {
    shouldRebalance = true;
    reason = `Price moved ${deviation.toFixed(2)}% outside range (threshold: ${this.config.rebalanceThresholdPercent}%)`;
  } else {
    reason = `Price out of range but deviation ${deviation.toFixed(2)}% below threshold ${this.config.rebalanceThresholdPercent}%`;
  }
}
```

**After:**
```typescript
if (!inRange) {
  shouldRebalance = true;
  reason = `Position OUT_OF_RANGE: current tick ${pool.currentTick} is outside [${position.tickLower}, ${position.tickUpper}]`;
}
```

**Changes:**
- Removed threshold check from shouldRebalance logic
- Set `shouldRebalance = true` immediately when position is OUT_OF_RANGE
- Updated reason message to clearly indicate OUT_OF_RANGE status

### 2. RebalancingBot (`src/services/rebalancingBot.ts`)

**Before:**
```typescript
// Check if rebalancing is needed
if (!report.shouldRebalance) {
  logger.info(`No rebalancing needed: ${report.reason}`);
  return;
}

// Check if deviation exceeds threshold
if (Math.abs(report.priceDeviation) < this.config.rebalanceThresholdPercent) {
  logger.info(
    `Deviation ${report.priceDeviation.toFixed(2)}% below threshold ${this.config.rebalanceThresholdPercent}%`
  );
  return;
}
```

**After:**
```typescript
// Check if rebalancing is needed (based on OUT_OF_RANGE status)
if (!report.shouldRebalance) {
  logger.info(`No rebalancing needed: ${report.reason}`);
  return;
}
```

**Changes:**
- Removed redundant threshold check
- Now relies solely on `report.shouldRebalance` which is based on OUT_OF_RANGE status
- Added clarifying comment

## Logic Flow

### Position Check
The `isTickInRange` function (unchanged) in `src/utils/tickMath.ts` implements:
```typescript
export function isTickInRange(
  currentTick: number,
  tickLower: number,
  tickUpper: number
): boolean {
  return currentTick >= tickLower && currentTick <= tickUpper;
}
```

This returns:
- `true` when position is IN RANGE: `tickLower <= currentTick <= tickUpper`
- `false` when position is OUT_OF_RANGE: `currentTick < tickLower OR currentTick > tickUpper`

### Rebalancing Trigger

**New Logic:**
1. Compare `currentTick` with position's `tickLower` and `tickUpper`
2. If `currentTick < tickLower` OR `currentTick > tickUpper`: Mark as OUT_OF_RANGE
3. If OUT_OF_RANGE: Set `shouldRebalance = true`
4. Rebalance when `shouldRebalance = true`

**What Changed:**
- Removed threshold-based gating
- Rebalancing now triggers immediately when position goes OUT_OF_RANGE
- No longer requires deviation to exceed configured threshold

**What Stayed the Same:**
- `rebalanceThresholdPercent` config still exists (not removed)
- `calculateTickRange()` logic unchanged
- `calculatePriceDeviation()` logic unchanged
- Range calculation based on `rangeWidthPercent` unchanged

## Example Scenarios

### Scenario 1: Position Goes Out of Range (Small Deviation)
**State:**
- Current tick: 10500
- Position range: [10000, 10400]
- Deviation: 2.5% (previously below 5% threshold)

**Old Behavior:**
- Position OUT_OF_RANGE: Yes
- Deviation < Threshold: Yes
- Action: No rebalance (waited for threshold)

**New Behavior:**
- Position OUT_OF_RANGE: Yes
- Action: **Rebalance immediately**

### Scenario 2: Position Goes Out of Range (Large Deviation)
**State:**
- Current tick: 11000
- Position range: [10000, 10400]
- Deviation: 15%

**Old Behavior:**
- Position OUT_OF_RANGE: Yes
- Deviation >= Threshold: Yes
- Action: Rebalance

**New Behavior:**
- Position OUT_OF_RANGE: Yes
- Action: **Rebalance immediately** (same outcome, simpler logic)

### Scenario 3: Position In Range
**State:**
- Current tick: 10200
- Position range: [10000, 10400]

**Old Behavior:**
- Position OUT_OF_RANGE: No
- Action: No rebalance

**New Behavior:**
- Position OUT_OF_RANGE: No
- Action: **No rebalance** (same outcome)

## Benefits

1. **Simpler Logic**: Removed complex threshold checking from rebalancing trigger
2. **Faster Response**: Rebalances immediately when position goes out of range
3. **Clearer Intent**: Code directly implements "rebalance when OUT_OF_RANGE" requirement
4. **Reduced Code**: Removed ~11 lines of conditional logic

## Configuration Notes

The following configuration parameters are still used:
- `rangeWidthPercent`: Used in `calculateTickRange()` for new position range
- `rebalanceThresholdPercent`: Still in config but **no longer used** for rebalancing trigger
- `maxSlippagePercent`: Used in rebalance execution for slippage protection
- Other config parameters remain unchanged

## Testing Recommendations

1. Test with position IN RANGE: Should not rebalance
2. Test with position OUT_OF_RANGE (below lower): Should rebalance immediately
3. Test with position OUT_OF_RANGE (above upper): Should rebalance immediately
4. Test edge case: currentTick exactly at tickLower: Should not rebalance (inclusive boundary)
5. Test edge case: currentTick exactly at tickUpper: Should not rebalance (inclusive boundary)

## Build Status

✅ TypeScript compilation successful
✅ No type errors
✅ All modules build correctly
