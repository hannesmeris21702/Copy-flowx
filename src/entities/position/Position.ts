import BN from "bn.js";
import { Pool, PoolReward } from "../pool/Pool";
import { Coin, Fraction, ZERO } from "../../utils/sdkTypes";
import { Q128 } from "../../constants";
import {
  tickIndexToSqrtPriceX64,
  getAmountsFromLiquidity,
  getLiquidityFromAmounts,
} from "../../utils/tickMath";

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
    const amounts = this.calculateAmounts();
    return {
      coin: this.pool.coinX,
      toExact: (opts: any) => amounts.amountA.toString(),
    };
  }

  get amountY(): { coin: Coin; toExact: (opts: any) => string } {
    const amounts = this.calculateAmounts();
    return {
      coin: this.pool.coinY,
      toExact: (opts: any) => amounts.amountB.toString(),
    };
  }

  /**
   * Calculate token amounts from liquidity using proper tick math
   */
  private calculateAmounts(): { amountA: BN; amountB: BN } {
    const sqrtPriceCurrent = new BN(this.pool.sqrtPriceX64);
    const sqrtPriceLower = tickIndexToSqrtPriceX64(this.tickLower);
    const sqrtPriceUpper = tickIndexToSqrtPriceX64(this.tickUpper);
    const liquidityBN = new BN(this.liquidity);

    return getAmountsFromLiquidity(
      sqrtPriceCurrent,
      sqrtPriceLower,
      sqrtPriceUpper,
      liquidityBN,
      false
    );
  }

  /**
   * Get the amounts to mint for this position
   */
  get mintAmounts(): { amountX: BN; amountY: BN } {
    const amounts = this.calculateAmounts();
    return {
      amountX: amounts.amountA,
      amountY: amounts.amountB,
    };
  }

  /**
   * Calculate fees owed to this position
   * Formula: (feeGrowthInside - feeGrowthInsideLast) * liquidity / Q128
   */
  async getFees(): Promise<{ amountX: BN; amountY: BN }> {
    // Start with coins already owed
    let feesX = new BN(this.coinsOwedX);
    let feesY = new BN(this.coinsOwedY);

    // Calculate fee growth inside the position's range
    const feeGrowthInsideX = this.calculateFeeGrowthInside(
      new BN(this.pool.feeGrowthGlobalX),
      this.pool.tickCurrent,
      this.tickLower,
      this.tickUpper,
      // In a full implementation, we would fetch tick-specific fee growth
      // For now, use simplified calculation
      new BN(0), // feeGrowthOutsideLower
      new BN(0)  // feeGrowthOutsideUpper
    );

    const feeGrowthInsideY = this.calculateFeeGrowthInside(
      new BN(this.pool.feeGrowthGlobalY),
      this.pool.tickCurrent,
      this.tickLower,
      this.tickUpper,
      new BN(0),
      new BN(0)
    );

    // Calculate accrued fees since last collection
    const feeGrowthInsideXLast = new BN(this.feeGrowthInsideXLast);
    const feeGrowthInsideYLast = new BN(this.feeGrowthInsideYLast);
    const liquidityBN = new BN(this.liquidity);

    // Fee amount = (feeGrowthInside - feeGrowthInsideLast) * liquidity / Q128
    const feeGrowthDeltaX = feeGrowthInsideX.sub(feeGrowthInsideXLast);
    const feeGrowthDeltaY = feeGrowthInsideY.sub(feeGrowthInsideYLast);

    const accruedFeesX = feeGrowthDeltaX.mul(liquidityBN).div(new BN(Q128.toString()));
    const accruedFeesY = feeGrowthDeltaY.mul(liquidityBN).div(new BN(Q128.toString()));

    feesX = feesX.add(accruedFeesX);
    feesY = feesY.add(accruedFeesY);

    return {
      amountX: feesX,
      amountY: feesY,
    };
  }

  /**
   * Calculate fee growth inside a position's range
   * This is a simplified implementation - in production, you'd fetch tick-specific data
   */
  private calculateFeeGrowthInside(
    feeGrowthGlobal: BN,
    tickCurrent: number,
    tickLower: number,
    tickUpper: number,
    feeGrowthOutsideLower: BN,
    feeGrowthOutsideUpper: BN
  ): BN {
    let feeGrowthBelow: BN;
    let feeGrowthAbove: BN;

    // Calculate fee growth below the lower tick
    if (tickCurrent >= tickLower) {
      feeGrowthBelow = feeGrowthOutsideLower;
    } else {
      feeGrowthBelow = feeGrowthGlobal.sub(feeGrowthOutsideLower);
    }

    // Calculate fee growth above the upper tick
    if (tickCurrent < tickUpper) {
      feeGrowthAbove = feeGrowthOutsideUpper;
    } else {
      feeGrowthAbove = feeGrowthGlobal.sub(feeGrowthOutsideUpper);
    }

    // Fee growth inside = global - below - above
    return feeGrowthGlobal.sub(feeGrowthBelow).sub(feeGrowthAbove);
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
   * Create a position from token amounts using proper tick math
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
    // Get sqrt prices for the ticks
    const sqrtPriceCurrent = new BN(pool.sqrtPriceX64);
    const sqrtPriceLower = tickIndexToSqrtPriceX64(tickLower);
    const sqrtPriceUpper = tickIndexToSqrtPriceX64(tickUpper);

    // Calculate liquidity from amounts using proper CLMM math
    const liquidity = getLiquidityFromAmounts(
      sqrtPriceCurrent,
      sqrtPriceLower,
      sqrtPriceUpper,
      amountX,
      amountY
    );

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
