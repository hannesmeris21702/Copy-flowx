/**
 * Open Position Execution
 * Handles creation of new CLMM positions via Move calls
 */

import { Transaction, TransactionObjectArgument } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import BN from "bn.js";
import { Pool } from "../entities";
import { getLogger } from "../utils/Logger";
import { getCetusConfig } from "../sdk/cetusSDK";

const logger = getLogger(module);

/**
 * Position parameters for opening
 */
export interface OpenPositionParams {
  pool: Pool;
  tickLower: number;
  tickUpper: number;
  amountX: BN;
  amountY: BN;
  minAmountX?: BN;
  minAmountY?: BN;
}

/**
 * Open position result
 */
export interface OpenPositionResult {
  success: boolean;
  positionId?: string;
  error?: string;
}

/**
 * Open a new CLMM position
 * Constructs Move calls to mint position NFT and add liquidity
 * 
 * @param params - Position parameters
 * @param coinX - Token X coin object (or array of coins)
 * @param coinY - Token Y coin object (or array of coins)
 * @param tx - Transaction block to append operations to
 * @returns Transaction result object for position NFT
 */
export function openPosition(
  params: OpenPositionParams,
  coinX: TransactionObjectArgument,
  coinY: TransactionObjectArgument,
  tx: Transaction
): TransactionObjectArgument {
  const { pool, tickLower, tickUpper, amountX, amountY } = params;

  logger.info(
    `OpenPosition: Creating position - ` +
      `Pool: ${pool.id}, ` +
      `Range: [${tickLower}, ${tickUpper}], ` +
      `Amount X: ${amountX.toString()}, ` +
      `Amount Y: ${amountY.toString()}`
  );

  const config = getCetusConfig();

  // Use provided minimum amounts or default to input amounts (no slippage)
  const minAmountX = params.minAmountX || amountX;
  const minAmountY = params.minAmountY || amountY;

  // Handle negative ticks properly
  const tickLowerAbs = Math.abs(tickLower);
  const tickUpperAbs = Math.abs(tickUpper);
  const isTickLowerNegative = tickLower < 0;
  const isTickUpperNegative = tickUpper < 0;

  // Step 1: Mint position NFT
  logger.info("OpenPosition: Minting position NFT...");
  const position = tx.moveCall({
    target: `${config.packageId}::position::mint`,
    arguments: [tx.object(config.poolsId)],
  });

  // Step 2: Open position with liquidity using pool_script
  logger.info("OpenPosition: Opening position with liquidity...");
  const [remainingX, remainingY] = tx.moveCall({
    target: `${config.packageId}::pool_script::open_position`,
    typeArguments: [pool.coinX.coinType, pool.coinY.coinType],
    arguments: [
      tx.object(config.globalConfigId), // Global config
      tx.object(config.poolsId), // Pools registry
      tx.object(pool.id), // Pool
      position, // Position NFT
      tx.pure.u32(tickLowerAbs), // Tick lower (absolute value)
      tx.pure.bool(isTickLowerNegative), // Is tick lower negative
      tx.pure.u32(tickUpperAbs), // Tick upper (absolute value)
      tx.pure.bool(isTickUpperNegative), // Is tick upper negative
      coinX, // Coin X
      coinY, // Coin Y
      tx.pure.u64(amountX.toString()), // Desired amount X
      tx.pure.u64(amountY.toString()), // Desired amount Y
      tx.pure.u64(minAmountX.toString()), // Min amount X
      tx.pure.u64(minAmountY.toString()), // Min amount Y
      tx.object(SUI_CLOCK_OBJECT_ID), // Clock object
    ],
  });

  logger.info("OpenPosition: Move calls constructed successfully");

  // Transfer position NFT to sender (get sender from transaction)
  // Note: Transaction will automatically handle the transfer
  // tx.transferObjects([position], tx.pure.address(sender));

  // Return any remaining coins would be handled by the caller

  return position;
}

/**
 * Calculate required token amounts for a position
 * Based on liquidity, tick range, and current pool price
 * 
 * Note: This is a simplified calculation
 * Production implementation would use precise liquidity math
 * 
 * @param pool - Pool object
 * @param tickLower - Lower tick
 * @param tickUpper - Upper tick
 * @param liquidity - Desired liquidity amount
 * @returns Required token amounts
 */
export function calculateRequiredAmounts(
  pool: Pool,
  tickLower: number,
  tickUpper: number,
  liquidity: BN
): { amountX: BN; amountY: BN } {
  logger.info(
    `OpenPosition: Calculating required amounts - ` +
      `Liquidity: ${liquidity.toString()}, Range: [${tickLower}, ${tickUpper}]`
  );

  // TODO: Implement precise liquidity math calculation
  // Would use pool's sqrt price and tick math to calculate exact amounts
  // For now, return approximate values

  const currentTick = pool.tickCurrent;

  // Simplified logic:
  // If current tick < lower: need only X
  // If current tick > upper: need only Y
  // Otherwise: need both X and Y

  let amountX = new BN(0);
  let amountY = new BN(0);

  if (currentTick < tickLower) {
    // Need only X
    amountX = liquidity.div(new BN(1000)); // Simplified
  } else if (currentTick > tickUpper) {
    // Need only Y
    amountY = liquidity.div(new BN(1000)); // Simplified
  } else {
    // Need both
    amountX = liquidity.div(new BN(2000)); // Simplified
    amountY = liquidity.div(new BN(2000)); // Simplified
  }

  logger.info(
    `OpenPosition: Required amounts - X: ${amountX.toString()}, Y: ${amountY.toString()}`
  );

  return { amountX, amountY };
}

/**
 * Validate position parameters before opening
 * 
 * @param params - Position parameters
 * @returns Validation result
 */
export function validatePositionParams(params: OpenPositionParams): {
  isValid: boolean;
  error?: string;
} {
  const { pool, tickLower, tickUpper, amountX, amountY } = params;

  // Check tick range validity
  if (tickLower >= tickUpper) {
    return {
      isValid: false,
      error: `Invalid tick range: lower (${tickLower}) >= upper (${tickUpper})`,
    };
  }

  // Check tick alignment with pool spacing
  if (tickLower % pool.tickSpacing !== 0 || tickUpper % pool.tickSpacing !== 0) {
    return {
      isValid: false,
      error: `Ticks must be aligned with pool tick spacing (${pool.tickSpacing})`,
    };
  }

  // Check amounts are positive
  if (amountX.isZero() && amountY.isZero()) {
    return {
      isValid: false,
      error: "At least one token amount must be non-zero",
    };
  }

  // Check current tick is within range
  const currentTick = pool.tickCurrent;
  if (currentTick < tickLower || currentTick > tickUpper) {
    return {
      isValid: false,
      error: `Current tick (${currentTick}) not within range [${tickLower}, ${tickUpper}]`,
    };
  }

  logger.info("OpenPosition: Parameters validated successfully");
  return { isValid: true };
}
