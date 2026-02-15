export interface BotConfig {
  privateKey: string;
  rpcUrl: string;
  network: string;
  checkIntervalMs: number;
  rangeWidthPercent: number;
}

export interface Position {
  id: string;
  poolId: string;
  liquidity: string;
  coinTypeA: string;
  coinTypeB: string;
  tickLower: number;
  tickUpper: number;
}

export interface Pool {
  id: string;
  coinTypeA: string;
  coinTypeB: string;
  currentTick: number;
  tickSpacing: number;
}
