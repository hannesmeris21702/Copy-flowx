export interface BotConfig {
  privateKey: string;
  rpcUrl: string;
  poolId: string;
  positionId: string;
  rebalanceThresholdPercent: number;
  rangeWidthPercent: number;
  checkIntervalMs: number;
  maxSlippagePercent: number;
  maxGasPrice: number;
  minRetryDelayMs: number;
  maxRetryDelayMs: number;
  maxRetries: number;
  swapRatioTolerancePercent: number;
  stateFilePath?: string; // Optional path for state persistence file
}

export interface Position {
  id: string;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  coinA: string;
  coinB: string;
}

export interface Pool {
  id: string;
  coinTypeA: string;
  coinTypeB: string;
  currentSqrtPrice: string;
  currentTick: number;
  tickSpacing: number;
  feeRate: number;
}

// Rebalance state tracking
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
