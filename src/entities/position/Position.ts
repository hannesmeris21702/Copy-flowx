import BN from "bn.js";
import { Pool, PoolReward } from "../pool/Pool";
import { Coin, Fraction, ZERO } from "../../utils/sdkTypes";
import { Q128 } from "../../constants";

export interface PositionRewardInfo {
  coinsOwedReward: string;
  rewardGrowthInsideLast: string;
}

export class Position {
  public readonly id: string;
  public readonly owner: string;
  public readonly pool: Pool;
  public readonly tickLower: number;
  public readonly tickUpper: number;
  public readonly liquidity: string;
  public readonly coinsOwedX: string;
  public readonly coinsOwedY: string;
  public readonly feeGrowthInsideXLast: string;
  public readonly feeGrowthInsideYLast: string;
  public readonly rewardInfos: PositionRewardInfo[];

  constructor({
    objectId,
    owner,
    pool,
    tickLower,
    tickUpper,
    liquidity,
    coinsOwedX,
    coinsOwedY,
    feeGrowthInsideXLast,
    feeGrowthInsideYLast,
    rewardInfos,
  }: {
    objectId: string;
    owner: string;
    pool: Pool;
    tickLower: number;
    tickUpper: number;
    liquidity: string | BN;
    coinsOwedX?: string | BN;
    coinsOwedY?: string | BN;
    feeGrowthInsideXLast?: string | BN;
    feeGrowthInsideYLast?: string | BN;
    rewardInfos?: PositionRewardInfo[];
  }) {
    this.id = objectId;
    this.owner = owner;
    this.pool = pool;
    this.tickLower = tickLower;
    this.tickUpper = tickUpper;
    this.liquidity = liquidity.toString();
    this.coinsOwedX = (coinsOwedX || "0").toString();
    this.coinsOwedY = (coinsOwedY || "0").toString();
    this.feeGrowthInsideXLast = (feeGrowthInsideXLast || "0").toString();
    this.feeGrowthInsideYLast = (feeGrowthInsideYLast || "0").toString();
    this.rewardInfos = rewardInfos || [];
  }

  /**
   * Get the amounts of tokens in this position
   */
  get amountX(): { coin: Coin; toExact: (opts: any) => string } {
    // Simplified calculation - will be enhanced with proper tick math
    const amount = new BN(this.liquidity).div(new BN(2));
    return {
      coin: this.pool.coinX,
      toExact: (opts: any) => amount.toString(),
    };
  }

  get amountY(): { coin: Coin; toExact: (opts: any) => string } {
    // Simplified calculation - will be enhanced with proper tick math
    const amount = new BN(this.liquidity).div(new BN(2));
    return {
      coin: this.pool.coinY,
      toExact: (opts: any) => amount.toString(),
    };
  }

  /**
   * Get the amounts to mint for this position
   */
  get mintAmounts(): { amountX: BN; amountY: BN } {
    // Simplified - TODO: implement proper liquidity to amount conversion
    const liquidityBN = new BN(this.liquidity);
    return {
      amountX: liquidityBN.div(new BN(2)),
      amountY: liquidityBN.div(new BN(2)),
    };
  }

  /**
   * Calculate fees owed to this position
   */
  async getFees(): Promise<{ amountX: BN; amountY: BN }> {
    // Simplified fee calculation
    // In a full implementation, this would:
    // 1. Fetch tick data for tickLower and tickUpper
    // 2. Calculate feeGrowthInside based on global and tick-specific fee growth
    // 3. Compute fees as: (feeGrowthInside - feeGrowthInsideLast) * liquidity / Q128

    const coinsOwedX = new BN(this.coinsOwedX);
    const coinsOwedY = new BN(this.coinsOwedY);

    // For now, return the coins owed (which includes accrued fees)
    return {
      amountX: coinsOwedX,
      amountY: coinsOwedY,
    };
  }

  /**
   * Calculate rewards owed to this position
   */
  async getRewards(): Promise<BN[]> {
    // Return rewards based on reward infos
    return this.rewardInfos.map(
      (info) => new BN(info.coinsOwedReward)
    );
  }

  /**
   * Create a position from token amounts
   * This is a factory method that calculates the liquidity from amounts
   */
  static fromAmounts({
    owner,
    pool,
    tickLower,
    tickUpper,
    amountX,
    amountY,
    useFullPrecision = false,
  }: {
    owner: string;
    pool: Pool;
    tickLower: number;
    tickUpper: number;
    amountX: BN;
    amountY: BN;
    useFullPrecision?: boolean;
  }): Position {
    // Simplified liquidity calculation
    // In a full implementation, this would use proper tick math to convert amounts to liquidity
    // For now, use a simplified approach
    const liquidity = amountX.add(amountY);

    return new Position({
      objectId: "",  // Will be set when position is created on-chain
      owner,
      pool,
      tickLower,
      tickUpper,
      liquidity: liquidity.toString(),
      coinsOwedX: "0",
      coinsOwedY: "0",
      feeGrowthInsideXLast: "0",
      feeGrowthInsideYLast: "0",
      rewardInfos: [],
    });
  }
}
