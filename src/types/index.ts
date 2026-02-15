export interface BotConfig {
  privateKey: string;
  rpcUrl: string;
  network: string;
}

export interface Position {
  id: string;
  poolId: string;
  liquidity: string;
  coinTypeA: string;
  coinTypeB: string;
}
