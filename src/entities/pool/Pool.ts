import { BigintIsh, ClmmPool, Coin } from "@flowx-finance/sdk";
import { ClmmProtocol } from "../../constants";

export class Pool extends ClmmPool {
  public readonly protocol: ClmmProtocol;

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
    tickDataProvider,
  }: {
    objectId: string;
    coins: Coin[];
    poolRewards: any[];
    reserves: BigintIsh[];
    fee: number;
    sqrtPriceX64: BigintIsh;
    tickCurrent: number;
    liquidity: BigintIsh;
    protocol: ClmmProtocol;
    feeGrowthGlobalX: BigintIsh;
    feeGrowthGlobalY: BigintIsh;
    tickDataProvider?: any;
  }) {
    super(
      objectId,
      coins,
      poolRewards,
      reserves,
      fee,
      sqrtPriceX64,
      tickCurrent,
      liquidity,
      feeGrowthGlobalX,
      feeGrowthGlobalY,
      tickDataProvider
    );
    this.protocol = protocol;
  }
}
