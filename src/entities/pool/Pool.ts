import BN from "bn.js";
import { BigintIsh, ClmmProtocol } from "../../constants";
import { Coin, Fraction } from "../../utils/sdkTypes";

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

  /**
   * Get the ratio of liquidity for a given tick range
   * This is used by ZapCalculator to determine token ratios
   */
  getRatio(tickLower: number, tickUpper: number): Fraction {
    // Simplified implementation for now
    // TODO: Implement proper tick math for ratio calculation
    const currentTick = this.tickCurrent;
    
    // If current tick is below range, all in token Y
    if (currentTick < tickLower) {
      return new Fraction(0, 1);
    }
    // If current tick is above range, all in token X (use large number instead of infinity)
    if (currentTick >= tickUpper) {
      return new Fraction(Number.MAX_SAFE_INTEGER, 1);
    }
    // If in range, calculate ratio based on current price
    // Simplified: return 1:1 ratio
    return new Fraction(1, 1);
  }
}
