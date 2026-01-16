import invariant from "tiny-invariant";
import { Coin, Protocol, TickOnchainDataProvider } from "@flowx-finance/sdk";
import { SuiObjectData } from "@mysten/sui/client";

import { Pool } from "./Pool";
import { jsonRpcProvider } from "../../utils/jsonRpcProvider";
import { getToken } from "../../utils/tokenHelper";
import { MAPPING_POOL_OBJECT_TYPE, TICK_INDEX_BITS } from "../../constants";
import { FlowXV3PoolRawData } from ",./../types";
import { IPoolProvder } from "./IPoolProvder";

export class FlowXV3PoolProvider implements IPoolProvder {
  public async getPoolById(poolId: string): Promise<Pool> {
    const object = await jsonRpcProvider.getObject({
      id: poolId,
      options: {
        showContent: true,
        showType: true,
        showOwner: true,
      },
    });

    invariant(
      object.data && object.data.type.startsWith(MAPPING_POOL_OBJECT_TYPE[Protocol.FLOWX_V3]),
      "invalid pool"
    );

    return this._fromObjectData(object.data);
  }

  private async _fromObjectData(object: SuiObjectData): Promise<Pool> {
    const rawData = object.content["fields"] as FlowXV3PoolRawData;

    const tokens = await Promise.all([
      getToken(`0x${rawData.coin_type_x.fields.name}`),
      getToken(`0x${rawData.coin_type_y.fields.name}`),
    ]);

    const pool = new Pool({
      objectId: object.objectId,
      coins: tokens,
      poolRewards: rawData.reward_infos.map((rewardInfo) => ({
        coin: new Coin(`0x${rewardInfo.fields.reward_coin_type.fields.name}`),
        endedAtSeconds: Number(rewardInfo.fields.ended_at_seconds),
        lastUpdateTime: Number(rewardInfo.fields.last_update_time),
        rewardPerSeconds: rewardInfo.fields.reward_per_seconds,
        totalReward: rewardInfo.fields.total_reward,
        rewardGrowthGlobal: rewardInfo.fields.reward_growth_global,
      })),
      reserves: [rawData.reserve_x, rawData.reserve_y],
      fee: Number(rawData.swap_fee_rate),
      sqrtPriceX64: rawData.sqrt_price,
      tickCurrent: Number(
        BigInt.asIntN(TICK_INDEX_BITS, BigInt(rawData.tick_index.fields.bits))
      ),
      liquidity: rawData.liquidity,
      feeGrowthGlobalX: rawData.fee_growth_global_x,
      feeGrowthGlobalY: rawData.fee_growth_global_y,
      tickDataProvider: new TickOnchainDataProvider({
        network: "mainnet",
        tickManagerId: rawData.ticks.fields.id.id,
      }),
      protocol: Protocol.FLOWX_V3,
    });

    return pool;
  }

}