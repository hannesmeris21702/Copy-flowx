/**
 * Swap Execution
 * Handles token swaps via Cetus router with simulation and safety checks
 */

import { Transaction, TransactionObjectArgument } from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import BN from "bn.js";
import { Pool } from "../entities";
import { Percent } from "../utils/sdkTypes";
import { getLogger } from "../utils/Logger";
import { getCetusConfig } from "../sdk/cetusSDK";

const logger = getLogger(module);

/**
 * Swap parameters
 */
export interface SwapParams {
  pool: Pool;
  amountIn: BN;
  amountOut: BN;
  isXToY: boolean; // true = swap X to Y, false = swap Y to X
  slippageTolerance: Percent;
  sqrtPriceLimit?: string;
}

/**
 * Swap result
 */
export interface SwapResult {
  success: boolean;
  amountIn: BN;
  amountOut: BN;
  error?: string;
}

/**
 * Execute a swap on Cetus CLMM pool
 * Constructs Move call to swap on Cetus router
 * 
 * @param params - Swap parameters
 * @param coinIn - Input coin transaction object
 * @param tx - Transaction block to append operations to
 * @returns Transaction result object for output coin
 */
export function executeSwap(
  params: SwapParams,
  coinIn: TransactionObjectArgument,
  tx: Transaction
): TransactionObjectArgument {
  const { pool, amountIn, isXToY, slippageTolerance } = params;

  logger.info(
    `Swap: Executing swap - ` +
      `Pool: ${pool.id}, ` +
      `Amount In: ${amountIn.toString()}, ` +
      `Direction: ${isXToY ? "X→Y" : "Y→X"}, ` +
      `Slippage: ${slippageTolerance.toFixed(2)}%`
  );

  const config = getCetusConfig();

  // Calculate minimum amount out based on slippage tolerance
  const amountOut = params.amountOut;
  const minAmountOut = amountOut
    .mul(new BN(10000).sub(slippageTolerance.numerator))
    .div(new BN(10000));

  logger.info(
    `Swap: Expected out: ${amountOut.toString()}, ` +
      `Min out (with slippage): ${minAmountOut.toString()}`
  );

  // Determine swap direction and construct Move call
  let coinOut: TransactionObjectArgument;

  if (isXToY) {
    // Swap X to Y
    [coinOut] = tx.moveCall({
      target: `${config.packageId}::pool_script::swap_a2b`,
      typeArguments: [pool.coinX.coinType, pool.coinY.coinType],
      arguments: [
        tx.object(config.globalConfigId), // Global config
        tx.object(config.poolsId), // Pools registry
        tx.object(pool.id), // Pool
        coinIn, // Input coin (X)
        tx.pure.u64(amountIn.toString()), // Amount in
        tx.pure.u64(minAmountOut.toString()), // Min amount out
        tx.pure.u128(params.sqrtPriceLimit || "0"), // Price limit (0 = no limit)
        tx.pure.bool(true), // Is exact input
        tx.object(SUI_CLOCK_OBJECT_ID), // Clock object
      ],
    });
  } else {
    // Swap Y to X
    [coinOut] = tx.moveCall({
      target: `${config.packageId}::pool_script::swap_b2a`,
      typeArguments: [pool.coinX.coinType, pool.coinY.coinType],
      arguments: [
        tx.object(config.globalConfigId), // Global config
        tx.object(config.poolsId), // Pools registry
        tx.object(pool.id), // Pool
        coinIn, // Input coin (Y)
        tx.pure.u64(amountIn.toString()), // Amount in
        tx.pure.u64(minAmountOut.toString()), // Min amount out
        tx.pure.u128(params.sqrtPriceLimit || "0"), // Price limit (0 = no limit)
        tx.pure.bool(true), // Is exact input
        tx.object(SUI_CLOCK_OBJECT_ID), // Clock object
      ],
    });
  }

  logger.info("Swap: Move call constructed successfully");

  return coinOut;
}

/**
 * Simulate a swap to estimate output amount
 * Note: Actual simulation would require calling the pool's swap math
 * This is a placeholder for the interface
 * 
 * @param params - Swap parameters
 * @returns Estimated output amount
 */
export async function simulateSwap(params: SwapParams): Promise<BN> {
  logger.info(`Swap: Simulating swap for amount ${params.amountIn.toString()}`);

  // TODO: Implement actual swap simulation
  // Would use pool math to calculate expected output
  // For now, return the provided amountOut
  
  const estimatedOut = params.amountOut;
  
  logger.info(`Swap: Simulation result - Estimated out: ${estimatedOut.toString()}`);
  
  return estimatedOut;
}

/**
 * Check if swap should be aborted due to safety constraints
 * 
 * @param params - Swap parameters
 * @param simulatedOut - Simulated output amount
 * @returns true if swap should abort
 */
export function shouldAbortSwap(
  params: SwapParams,
  simulatedOut: BN
): { shouldAbort: boolean; reason?: string } {
  const { amountOut, slippageTolerance } = params;

  // Check if simulated output is below minimum threshold
  const minAmountOut = amountOut
    .mul(new BN(10000).sub(slippageTolerance.numerator))
    .div(new BN(10000));

  if (simulatedOut.lt(minAmountOut)) {
    logger.warn(
      `Swap: ABORT - Simulated output ${simulatedOut.toString()} below minimum ${minAmountOut.toString()}`
    );
    return {
      shouldAbort: true,
      reason: `Simulated output below minimum (slippage > ${slippageTolerance.toFixed(2)}%)`,
    };
  }

  // Check for simulation failure (zero output)
  if (simulatedOut.isZero()) {
    logger.warn("Swap: ABORT - Simulation failed (zero output)");
    return {
      shouldAbort: true,
      reason: "Simulation failed",
    };
  }

  logger.info("Swap: Safety checks passed");
  return { shouldAbort: false };
}
