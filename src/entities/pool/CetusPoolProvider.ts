import { Protocol } from "../../utils/sdkTypes";
import { Coin } from "../../utils/sdkTypes";
import { Pool, PoolReward } from "./Pool";
import { IPoolProvder } from "./IPoolProvder";
import { jsonRpcProvider } from "../../utils/jsonRpcProvider";
import { getToken } from "../../utils/tokenHelper";
import BN from "bn.js";

/**
 * CetusPoolProvider fetches pool data from Cetus CLMM protocol
 */
export class CetusPoolProvider implements IPoolProvder {
  /**
   * Fetches pool data by pool ID from Sui blockchain
   * @param poolId - The Sui object ID of the pool
   * @returns Pool instance with all necessary data
   */
  async getPoolById(poolId: string): Promise<Pool> {
    // Fetch pool object from Sui blockchain
    const poolObject = await jsonRpcProvider.getObject({
      id: poolId,
      options: {
        showContent: true,
        showType: true,
        showOwner: true,
      },
    });

    if (!poolObject.data) {
      throw new Error(`Pool not found: ${poolId}`);
    }

    // Extract pool data from Move object
    const content = poolObject.data.content;
    if (content?.dataType !== "moveObject") {
      throw new Error(`Invalid pool object type: ${poolId}`);
    }

    const fields = content.fields as any;

    // Extract coin types from pool
    const coinTypeA = fields.coin_type_a || this.extractTypeArg(poolObject.data.type, 0);
    const coinTypeB = fields.coin_type_b || this.extractTypeArg(poolObject.data.type, 1);

    // Fetch token metadata
    const [tokenA, tokenB] = await Promise.all([
      getToken(coinTypeA),
      getToken(coinTypeB),
    ]);

    // Extract reward info if available
    const poolRewards: PoolReward[] = [];
    if (fields.rewarder_infos && Array.isArray(fields.rewarder_infos)) {
      for (const rewardInfo of fields.rewarder_infos) {
        const rewardCoinType = rewardInfo.reward_coin || rewardInfo.coinAddress;
        if (rewardCoinType) {
          poolRewards.push({
            coin: new Coin(rewardCoinType),
            endedAtSeconds: Number(rewardInfo.ended_at_seconds || 0),
            lastUpdateTime: Number(rewardInfo.last_update_time || rewardInfo.rewarder_last_updated_time || 0),
            rewardPerSeconds: rewardInfo.emissions_per_second?.toString() || "0",
            totalReward: rewardInfo.total_reward?.toString() || "0",
            rewardGrowthGlobal: rewardInfo.reward_growth_global?.toString() || rewardInfo.growth_global?.toString() || "0",
          });
        }
      }
    }

    // Create Pool instance
    return new Pool({
      objectId: poolId,
      coins: [tokenA, tokenB],
      poolRewards,
      reserves: [
        fields.coin_a || fields.coinAmountA || "0",
        fields.coin_b || fields.coinAmountB || "0",
      ],
      fee: Number(fields.fee_rate || fields.swap_fee_rate || 0),
      sqrtPriceX64: fields.current_sqrt_price || fields.sqrt_price || "0",
      tickCurrent: Number(fields.current_tick_index?.bits || fields.tick_index?.bits || 0),
      liquidity: fields.liquidity || "0",
      protocol: Protocol.CETUS,
      feeGrowthGlobalX: fields.fee_growth_global_a || fields.fee_growth_global_x || "0",
      feeGrowthGlobalY: fields.fee_growth_global_b || fields.fee_growth_global_y || "0",
      tickSpacing: Number(fields.tick_spacing || 60), // Default to 60 if not present
    });
  }

  /**
   * Extract type argument from a generic type string
   * @param typeStr - Full type string like "0xabc::pool::Pool<0x2::sui::SUI, 0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN>"
   * @param index - Index of type argument to extract (0-based)
   * @returns Extracted type argument
   */
  private extractTypeArg(typeStr: string, index: number): string {
    const match = typeStr.match(/<(.+)>/);
    if (!match) {
      throw new Error(`Cannot extract type arguments from: ${typeStr}`);
    }

    const typeArgs = this.splitTypeArgs(match[1]);
    if (index >= typeArgs.length) {
      throw new Error(`Type argument index ${index} out of bounds in: ${typeStr}`);
    }

    return typeArgs[index].trim();
  }

  /**
   * Split type arguments respecting nested generics
   * @param typeArgsStr - Type arguments string like "0x2::sui::SUI, 0x5d4b::coin::COIN"
   * @returns Array of individual type arguments
   */
  private splitTypeArgs(typeArgsStr: string): string[] {
    const result: string[] = [];
    let current = "";
    let depth = 0;

    for (let i = 0; i < typeArgsStr.length; i++) {
      const char = typeArgsStr[i];
      if (char === "<") {
        depth++;
        current += char;
      } else if (char === ">") {
        depth--;
        current += char;
      } else if (char === "," && depth === 0) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      result.push(current.trim());
    }

    return result;
  }
}
