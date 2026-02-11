import {
  Transaction,
  TransactionArgument,
  TransactionResult,
} from "@mysten/sui/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";

import { Percent } from "../../utils/sdkTypes";
import {
  IncreaseLiquidityOptions,
  DecreaseLiquidityOptions,
  CollectRewardsOptions,
  CollectOptions,
} from "../../types";
import { PositionManager } from "./PositionManager";
import { Position } from "./Position";
import { getLogger } from "../../utils/Logger";
import BN from "bn.js";

// Cetus mainnet package IDs
const CETUS_CLMM_MAINNET = {
  packageId: "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb",
  globalConfigId: "0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f",
  poolsId: "0xf699e7f2276f5c9a75944b37a0c5b5d9ddfd2471bf6242483b03ab2887d198d0",
};

/**
 * CetusPositionManager manages CLMM positions on Cetus protocol
 */
export class CetusPositionManager implements PositionManager {
  private readonly logger = getLogger(module);

  /**
   * Opens a new position NFT
   */
  openPosition = (position: Position) => (tx: Transaction): TransactionResult => {
    const { packageId, poolsId, globalConfigId } = CETUS_CLMM_MAINNET;

    // Convert tick indices to i32
    const tickLowerI32 = tx.pure.u32(Math.abs(position.tickLower));
    const tickUpperI32 = tx.pure.u32(Math.abs(position.tickUpper));

    // Determine if ticks are negative
    const isTickLowerNegative = position.tickLower < 0;
    const isTickUpperNegative = position.tickUpper < 0;

    // Call open_position function
    const positionNFT = tx.moveCall({
      target: `${packageId}::pool_script::open_position`,
      typeArguments: [
        position.pool.coinX.coinType,
        position.pool.coinY.coinType,
      ],
      arguments: [
        tx.object(globalConfigId),
        tx.object(poolsId),
        tx.object(position.pool.id),
        tickLowerI32,
        tx.pure.bool(isTickLowerNegative),
        tickUpperI32,
        tx.pure.bool(isTickUpperNegative),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });

    return positionNFT;
  };

  /**
   * Increases liquidity in an existing position
   */
  increaseLiquidity = (
    position: Position,
    options: IncreaseLiquidityOptions
  ) => (tx: Transaction): void | TransactionResult => {
    const { packageId, poolsId, globalConfigId } = CETUS_CLMM_MAINNET;

    const { amountX: amountXDesired, amountY: amountYDesired } = position.mintAmounts;

    // Calculate minimum amounts with slippage
    const minimumAmounts = {
      amountX: new Percent(1)
        .subtract(options.slippageTolerance)
        .multiply(amountXDesired)
        .asFraction.toFixed(0),
      amountY: new Percent(1)
        .subtract(options.slippageTolerance)
        .multiply(amountYDesired)
        .asFraction.toFixed(0),
    };

    // Use provided coins or create position
    let positionNFT: TransactionArgument;
    
    if (options.createPosition) {
      // Create new position
      positionNFT = this.openPosition(position)(tx) as TransactionArgument;
    } else {
      // Use existing position
      positionNFT = tx.object(position.id);
    }

    // Prepare coin inputs
    const coinX = options.coinXIn || tx.object("0x0"); // Placeholder if not provided
    const coinY = options.coinYIn || tx.object("0x0");

    // Call add_liquidity
    const [coinXOut, coinYOut] = tx.moveCall({
      target: `${packageId}::pool_script::add_liquidity`,
      typeArguments: [
        position.pool.coinX.coinType,
        position.pool.coinY.coinType,
      ],
      arguments: [
        tx.object(globalConfigId),
        tx.object(poolsId),
        tx.object(position.pool.id),
        positionNFT,
        coinX,
        coinY,
        tx.pure.u64(amountXDesired.toString()),
        tx.pure.u64(amountYDesired.toString()),
        tx.pure.u64(minimumAmounts.amountX),
        tx.pure.u64(minimumAmounts.amountY),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });

    // If creating position, return it
    if (options.createPosition) {
      return positionNFT as TransactionResult;
    }
  };

  /**
   * Decreases liquidity from a position
   */
  decreaseLiquidity = (
    position: Position,
    options: DecreaseLiquidityOptions
  ) => (tx: Transaction): TransactionResult => {
    const { packageId, poolsId, globalConfigId } = CETUS_CLMM_MAINNET;

    // Calculate amounts based on liquidity
    const liquidityBN = new BN(position.liquidity);
    const amountX = liquidityBN.div(new BN(2)); // Simplified
    const amountY = liquidityBN.div(new BN(2)); // Simplified

    // Calculate minimum amounts with slippage
    const minimumAmounts = {
      amountX: new Percent(1)
        .subtract(options.slippageTolerance)
        .multiply(amountX)
        .asFraction.toFixed(0),
      amountY: new Percent(1)
        .subtract(options.slippageTolerance)
        .multiply(amountY)
        .asFraction.toFixed(0),
    };

    // Call remove_liquidity
    const [coinXOut, coinYOut] = tx.moveCall({
      target: `${packageId}::pool_script::remove_liquidity`,
      typeArguments: [
        position.pool.coinX.coinType,
        position.pool.coinY.coinType,
      ],
      arguments: [
        tx.object(globalConfigId),
        tx.object(poolsId),
        tx.object(position.pool.id),
        tx.object(position.id),
        tx.pure.u128(position.liquidity),
        tx.pure.u64(minimumAmounts.amountX),
        tx.pure.u64(minimumAmounts.amountY),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });

    return [coinXOut, coinYOut] as any;
  };

  /**
   * Collects fees from a position
   */
  collect = (
    position: Position,
    options: CollectOptions
  ) => (tx: Transaction): TransactionResult => {
    const { packageId, poolsId, globalConfigId } = CETUS_CLMM_MAINNET;

    // Use max amounts if not specified
    const amountX = options.requestedAmountX?.toString() || "18446744073709551615"; // MaxUint64
    const amountY = options.requestedAmountY?.toString() || "18446744073709551615";

    // Call collect_fee
    const [coinXOut, coinYOut] = tx.moveCall({
      target: `${packageId}::pool_script::collect_fee`,
      typeArguments: [
        position.pool.coinX.coinType,
        position.pool.coinY.coinType,
      ],
      arguments: [
        tx.object(globalConfigId),
        tx.object(poolsId),
        tx.object(position.pool.id),
        tx.object(position.id),
        tx.pure.u64(amountX),
        tx.pure.u64(amountY),
      ],
    });

    return [coinXOut, coinYOut] as any;
  };

  /**
   * Collects rewards from a position
   */
  collectReward = (
    position: Position,
    options: CollectRewardsOptions
  ) => (tx: Transaction): TransactionResult => {
    const { packageId, poolsId, globalConfigId } = CETUS_CLMM_MAINNET;

    // Find reward index for the specified coin
    const rewardIndex = position.pool.poolRewards.findIndex(
      (reward) => reward.coin.coinType === options.rewardCoin.coinType
    );

    if (rewardIndex === -1) {
      throw new Error(`Reward coin ${options.rewardCoin.coinType} not found in pool`);
    }

    // Use max amount if not specified
    const amount = options.requestedAmount?.toString() || "18446744073709551615";

    // Call collect_reward
    const rewardCoin = tx.moveCall({
      target: `${packageId}::pool_script::collect_reward`,
      typeArguments: [
        position.pool.coinX.coinType,
        position.pool.coinY.coinType,
        options.rewardCoin.coinType,
      ],
      arguments: [
        tx.object(globalConfigId),
        tx.object(poolsId),
        tx.object(position.pool.id),
        tx.object(position.id),
        tx.pure.u64(rewardIndex),
        tx.pure.u64(amount),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });

    return rewardCoin;
  };

  /**
   * Closes a position NFT
   */
  closePosition = (position: Position) => (tx: Transaction): void => {
    const { packageId, poolsId, globalConfigId } = CETUS_CLMM_MAINNET;

    // Call close_position
    tx.moveCall({
      target: `${packageId}::pool_script::close_position`,
      typeArguments: [
        position.pool.coinX.coinType,
        position.pool.coinY.coinType,
      ],
      arguments: [
        tx.object(globalConfigId),
        tx.object(poolsId),
        tx.object(position.pool.id),
        tx.object(position.id),
      ],
    });
  };
}
