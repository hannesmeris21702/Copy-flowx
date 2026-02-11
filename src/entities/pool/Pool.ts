import BN from "bn.js";
import { BigintIsh, ClmmProtocol } from "../../constants";
import { Coin } from "../../utils/sdkTypes";

export interface PoolReward {
  coin: Coin;
  endedAtSeconds: number;
  lastUpdateTime: number;
  rewardPerSeconds: string;
  totalReward: string;
  rewardGrowthGlobal: string;
}

export class Pool {
  public readonly id: string;
  public readonly protocol: ClmmProtocol;
  public readonly coins: Coin[];
  public readonly poolRewards: PoolReward[];
  public readonly reserves: [string, string];
  public readonly fee: number;
  public readonly sqrtPriceX64: string;
  public readonly tickCurrent: number;
  public readonly liquidity: string;
  public readonly feeGrowthGlobalX: string;
  public readonly feeGrowthGlobalY: string;
  public readonly tickSpacing: number;
  public readonly tickDataProvider?: any;

  constructor({
    objectId,
    coins,
    poolRewards,
    reserves,
    fee,
    sqrtPriceX64,
    tickCurrent,
    liquidity,
    protocol,
    feeGrowthGlobalX,
    feeGrowthGlobalY,
    tickSpacing = 60, // Default for most CLMM pools
    tickDataProvider,
  }: {
    objectId: string;
    coins: Coin[];
    poolRewards: PoolReward[];
    reserves: BigintIsh[];
    fee: number;
    sqrtPriceX64: BigintIsh;
    tickCurrent: number;
    liquidity: BigintIsh;
    protocol: ClmmProtocol;
    feeGrowthGlobalX: BigintIsh;
    feeGrowthGlobalY: BigintIsh;
    tickSpacing?: number;
    tickDataProvider?: any;
  }) {
    this.id = objectId;
    this.coins = coins;
    this.poolRewards = poolRewards;
    this.reserves = [reserves[0].toString(), reserves[1].toString()];
    this.fee = fee;
    this.sqrtPriceX64 = sqrtPriceX64.toString();
    this.tickCurrent = tickCurrent;
    this.liquidity = liquidity.toString();
    this.protocol = protocol;
    this.feeGrowthGlobalX = feeGrowthGlobalX.toString();
    this.feeGrowthGlobalY = feeGrowthGlobalY.toString();
    this.tickSpacing = tickSpacing;
    this.tickDataProvider = tickDataProvider;
  }

  get coinX(): Coin {
    return this.coins[0];
  }

  get coinY(): Coin {
    return this.coins[1];
  }
}
