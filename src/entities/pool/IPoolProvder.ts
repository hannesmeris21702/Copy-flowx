import { Pool } from "./Pool";

export interface IPoolProvder {
  getPoolById(poolId: string): Promise<Pool>;
}
