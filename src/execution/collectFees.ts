/**
 * Collect Fees Execution
 * Handles collection of accrued fees and rewards from CLMM positions
 */

import { Transaction, TransactionObjectArgument } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import { Position } from "../entities";
import { getLogger } from "../utils/Logger";
import { getCetusConfig } from "../sdk/cetusSDK";

const logger = getLogger(module);

/**
 * Collect fees result
 */
export interface CollectFeesResult {
  success: boolean;
  feeX: string;
  feeY: string;
  error?: string;
}

/**
 * Collect accrued fees from a position
 * Constructs Move call to collect_fee on Cetus CLMM
 * 
 * @param position - Position to collect fees from
 * @param tx - Transaction block to append operations to
 * @returns Transaction result objects for collected fees
 */
export function collectFees(
  position: Position,
  tx: Transaction
): [TransactionObjectArgument, TransactionObjectArgument] {
  logger.info(
    `CollectFees: Collecting fees from position ${position.id}, ` +
      `owed X: ${position.coinsOwedX}, owed Y: ${position.coinsOwedY}`
  );

  const config = getCetusConfig();
  const pool = position.pool;

  // Construct Move call to collect_fee
  // Function: clmm::pool_script::collect_fee
  const [feeX, feeY] = tx.moveCall({
    target: `${config.packageId}::pool_script::collect_fee`,
    typeArguments: [pool.coinX.coinType, pool.coinY.coinType],
    arguments: [
      tx.object(config.globalConfigId), // Global config
      tx.object(config.poolsId), // Pools registry
      tx.object(pool.id), // Pool
      tx.object(position.id), // Position NFT
      tx.pure.u64("18446744073709551615"), // Max amount X (collect all)
      tx.pure.u64("18446744073709551615"), // Max amount Y (collect all)
    ],
  });

  logger.info("CollectFees: Move call constructed successfully");

  return [feeX, feeY];
}

/**
 * Collect protocol rewards from a position
 * Constructs Move call to collect_reward on Cetus CLMM
 * 
 * @param position - Position to collect rewards from
 * @param tx - Transaction block to append operations to
 * @param rewardIndex - Index of the reward to collect (0, 1, or 2)
 * @returns Transaction result object for collected reward
 */
export function collectReward(
  position: Position,
  tx: Transaction,
  rewardIndex: number
): TransactionObjectArgument {
  logger.info(
    `CollectReward: Collecting reward ${rewardIndex} from position ${position.id}`
  );

  const config = getCetusConfig();
  const pool = position.pool;

  // Get reward info for this index
  const rewardInfo = position.rewardInfos[rewardIndex];
  if (!rewardInfo) {
    logger.warn(`CollectReward: No reward at index ${rewardIndex}`);
    throw new Error(`No reward at index ${rewardIndex}`);
  }

  // Get reward coin type from pool rewards
  const poolReward = position.pool.poolRewards[rewardIndex];
  if (!poolReward) {
    logger.warn(`CollectReward: No pool reward at index ${rewardIndex}`);
    throw new Error(`No pool reward at index ${rewardIndex}`);
  }

  // Construct Move call to collect_reward
  // Function: clmm::pool_script::collect_reward
  const reward = tx.moveCall({
    target: `${config.packageId}::pool_script::collect_reward`,
    typeArguments: [
      pool.coinX.coinType,
      pool.coinY.coinType,
      poolReward.coin.coinType, // Reward token type
    ],
    arguments: [
      tx.object(config.globalConfigId), // Global config
      tx.object(config.poolsId), // Pools registry
      tx.object(pool.id), // Pool
      tx.object(position.id), // Position NFT
      tx.pure.u64(rewardIndex), // Reward index
      tx.pure.u64("18446744073709551615"), // Max amount (collect all)
      tx.object(SUI_CLOCK_OBJECT_ID), // Clock object
    ],
  });

  logger.info(`CollectReward: Move call constructed for reward ${rewardIndex}`);

  return reward;
}

/**
 * Collect all rewards from a position
 * Iterates through all reward slots and collects each
 * 
 * @param position - Position to collect rewards from
 * @param tx - Transaction block to append operations to
 * @returns Array of transaction result objects for collected rewards
 */
export function collectAllRewards(
  position: Position,
  tx: Transaction
): TransactionObjectArgument[] {
  logger.info(`CollectAllRewards: Collecting all rewards from position ${position.id}`);

  const rewards: TransactionObjectArgument[] = [];

  for (let i = 0; i < position.rewardInfos.length; i++) {
    try {
      const reward = collectReward(position, tx, i);
      rewards.push(reward);
    } catch (error) {
      logger.warn(`CollectAllRewards: Failed to collect reward ${i}:`, error.message);
    }
  }

  logger.info(`CollectAllRewards: Collected ${rewards.length} rewards`);

  return rewards;
}
