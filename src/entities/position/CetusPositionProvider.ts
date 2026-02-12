import { Protocol } from "../../utils/sdkTypes";
import { Position, PositionRewardInfo } from "./Position";
import { IPositionProvider } from "./IPositionProvider";
import { jsonRpcProvider } from "../../utils/jsonRpcProvider";
import { CetusPoolProvider } from "../pool/CetusPoolProvider";
import { MAPPING_POSITION_OBJECT_TYPE } from "../../constants";
import BN from "bn.js";

/**
 * CetusPositionProvider fetches position data from Cetus CLMM protocol
 */
export class CetusPositionProvider implements IPositionProvider {
  private poolProvider: CetusPoolProvider;

  constructor() {
    this.poolProvider = new CetusPoolProvider();
  }

  /**
   * Fetches a specific position by its object ID
   * @param positionId - The Sui object ID of the position NFT
   * @returns Position instance with all data
   */
  async getPositionById(positionId: string): Promise<Position> {
    // Fetch position object from Sui blockchain
    const positionObject = await jsonRpcProvider.getObject({
      id: positionId,
      options: {
        showContent: true,
        showType: true,
        showOwner: true,
      },
    });

    if (!positionObject.data) {
      throw new Error(`Position not found: ${positionId}`);
    }

    return this.parsePositionObject(positionObject.data);
  }

  /**
   * Gets the largest position owned by an address for a specific pool
   * @param ownerAddress - The Sui address of the position owner
   * @param poolId - The pool ID to filter positions
   * @returns The position with the most liquidity, or null if no valid position found
   */
  async getLargestPosition(ownerAddress: string, poolId: string): Promise<Position | null> {
    // Query all positions owned by the address
    const positionType = MAPPING_POSITION_OBJECT_TYPE[Protocol.CETUS];
    if (!positionType) {
      throw new Error("Cetus position type not configured");
    }

    // Get all objects owned by the address matching position type
    const ownedObjects = await jsonRpcProvider.getOwnedObjects({
      owner: ownerAddress,
      filter: {
        StructType: positionType,
      },
      options: {
        showContent: true,
        showType: true,
        showOwner: true,
      },
    });

    if (!ownedObjects.data || ownedObjects.data.length === 0) {
      throw new Error(`No positions found for owner: ${ownerAddress}`);
    }

    // Parse all positions and filter by pool
    const positions: Position[] = [];
    for (const obj of ownedObjects.data) {
      if (obj.data) {
        try {
          const position = await this.parsePositionObject(obj.data);
          if (position.pool.id === poolId) {
            positions.push(position);
          }
        } catch (error) {
          // Skip invalid positions
          console.warn(`Failed to parse position ${obj.data.objectId}:`, error);
        }
      }
    }

    if (positions.length === 0) {
      console.warn(`No positions found for pool ${poolId} and owner ${ownerAddress}`);
      return null;
    }

    // Find the position with the most liquidity
    let largestPosition = positions[0];
    let maxLiquidity = new BN(largestPosition.liquidity);

    for (let i = 1; i < positions.length; i++) {
      const liquidity = new BN(positions[i].liquidity);
      if (liquidity.gt(maxLiquidity)) {
        maxLiquidity = liquidity;
        largestPosition = positions[i];
      }
    }

    // Validate tick range before returning
    if (largestPosition.tickLower === 0 || largestPosition.tickUpper === 0) {
      console.warn("Invalid position ticks detected");
      return null;
    }

    return largestPosition;
  }

  /**
   * Parse a position object from Sui data
   * @param positionData - Raw Sui object data
   * @returns Parsed Position instance
   */
  private async parsePositionObject(positionData: any): Promise<Position> {
    const content = positionData.content;
    if (content?.dataType !== "moveObject") {
      throw new Error(`Invalid position object type`);
    }

    const fields = content.fields as any;

    // Extract owner
    let owner = "";
    if (positionData.owner) {
      if (typeof positionData.owner === "string") {
        owner = positionData.owner;
      } else if (positionData.owner.AddressOwner) {
        owner = positionData.owner.AddressOwner;
      } else if (positionData.owner.ObjectOwner) {
        owner = positionData.owner.ObjectOwner;
      }
    }

    // Get pool ID from position
    const poolId = fields.pool || fields.pool_id;
    if (!poolId) {
      throw new Error("Position does not have pool ID");
    }

    // Fetch pool data
    const pool = await this.poolProvider.getPoolById(poolId);

    // Parse reward infos
    const rewardInfos: PositionRewardInfo[] = [];
    if (fields.reward_infos && Array.isArray(fields.reward_infos)) {
      for (const rewardInfo of fields.reward_infos) {
        rewardInfos.push({
          coinsOwedReward: rewardInfo.reward_amount_owed?.toString() || 
                          rewardInfo.coins_owed_reward?.toString() || "0",
          rewardGrowthInsideLast: rewardInfo.reward_growth_inside?.toString() || 
                                  rewardInfo.reward_growth_inside_last?.toString() || "0",
        });
      }
    }

    // Handle tick indices (may be stored as objects with bits field or directly)
    const tickLower = this.parseTickIndex(fields.tick_lower_index || fields.tick_lower);
    const tickUpper = this.parseTickIndex(fields.tick_upper_index || fields.tick_upper);

    return new Position({
      objectId: positionData.objectId,
      owner,
      pool,
      tickLower,
      tickUpper,
      liquidity: fields.liquidity || "0",
      coinsOwedX: fields.fee_owed_a || fields.coins_owed_x || "0",
      coinsOwedY: fields.fee_owed_b || fields.coins_owed_y || "0",
      feeGrowthInsideXLast: fields.fee_growth_inside_a || fields.fee_growth_inside_x_last || "0",
      feeGrowthInsideYLast: fields.fee_growth_inside_b || fields.fee_growth_inside_y_last || "0",
      rewardInfos,
    });
  }

  /**
   * Parse tick index which may be stored as number or as object with bits field
   * @param tick - Tick value from on-chain data
   * @returns Parsed tick as number
   */
  private parseTickIndex(tick: any): number {
    if (typeof tick === "number") {
      return tick;
    }
    if (typeof tick === "string") {
      return Number(tick);
    }
    if (tick && typeof tick === "object") {
      if ("bits" in tick) {
        // Handle signed integer stored in bits field
        return Number(BigInt.asIntN(32, BigInt(tick.bits)));
      }
    }
    return 0;
  }
}
