export interface BotConfig {
  privateKey: string;
  rpcUrl: string;
  poolId: string;
  rebalanceThresholdPercent: number;
  rangeWidthPercent: number;
  checkIntervalMs: number;
  maxSlippagePercent: number;
  maxGasPrice: number;
  minRetryDelayMs: number;
  maxRetryDelayMs: number;
  maxRetries: number;
  swapRatioTolerancePercent: number;
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
