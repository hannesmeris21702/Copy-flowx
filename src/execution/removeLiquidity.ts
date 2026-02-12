/**
 * Remove Liquidity Execution
 * Handles removal of liquidity from CLMM positions via Move calls
 */

import { Transaction, TransactionObjectArgument } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import BN from "bn.js";
import { Position } from "../entities";
import { getLogger } from "../utils/Logger";
import { getCetusConfig } from "../sdk/cetusSDK";

const logger = getLogger(module);

/**
 * Remove liquidity result
 */
export interface RemoveLiquidityResult {
  success: boolean;
  amountX: BN;
  amountY: BN;
  error?: string;
}

/**
 * Remove all liquidity from a position
 * Constructs Move call to remove_liquidity on Cetus CLMM
 * 
 * @param position - Position to remove liquidity from
 * @param tx - Transaction block to append operations to
 * @returns Transaction result objects for removed amounts
 */
export function removeLiquidity(
  position: Position,
  tx: Transaction
): [TransactionObjectArgument, TransactionObjectArgument] {
  logger.info(
    `RemoveLiquidity: Removing liquidity from position ${position.id}, ` +
      `amount: ${position.liquidity}`
  );

  const config = getCetusConfig();
  const pool = position.pool;

  // Calculate minimum amounts (0 for full removal, slippage handled elsewhere)
  const minAmountX = "0";
  const minAmountY = "0";

  logger.info(
    `RemoveLiquidity: Params - ` +
      `liquidity: ${position.liquidity}, ` +
      `minAmountX: ${minAmountX}, ` +
      `minAmountY: ${minAmountY}`
  );

  // Construct Move call to remove_liquidity
  // Function: clmm::pool_script::remove_liquidity
  const [coinX, coinY] = tx.moveCall({
    target: `${config.packageId}::pool_script::remove_liquidity`,
    typeArguments: [pool.coinX.coinType, pool.coinY.coinType],
    arguments: [
      tx.object(config.globalConfigId), // Global config
      tx.object(config.poolsId), // Pools registry
      tx.object(pool.id), // Pool
      tx.object(position.id), // Position NFT
      tx.pure.u128(position.liquidity), // Liquidity to remove
      tx.pure.u64(minAmountX), // Min amount X
      tx.pure.u64(minAmountY), // Min amount Y
      tx.object(SUI_CLOCK_OBJECT_ID), // Clock object
    ],
  });

  logger.info("RemoveLiquidity: Move call constructed successfully");

  return [coinX, coinY];
}

/**
 * Estimate amounts that will be removed
 * Note: Actual on-chain calculation is complex, this is an approximation
 * 
 * @param position - Position to estimate for
 * @returns Estimated amounts
 */
export function estimateRemovalAmounts(position: Position): {
  amountX: BN;
  amountY: BN;
} {
  // Use the calculated amounts from the position
  const amounts = position.mintAmounts;
  const amountX = amounts.amountX;
  const amountY = amounts.amountY;

  logger.info(
    `RemoveLiquidity: Estimated removal - X: ${amountX.toString()}, Y: ${amountY.toString()}`
  );

  return { amountX, amountY };
}
