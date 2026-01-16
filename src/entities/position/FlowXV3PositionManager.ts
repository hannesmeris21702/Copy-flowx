import {
  coinWithBalance,
  Transaction,
  TransactionArgument,
  TransactionResult,
} from "@mysten/sui/transactions";
import {
  normalizeStructTag,
  SUI_CLOCK_OBJECT_ID,
  SUI_TYPE_ARG,
} from "@mysten/sui/utils";

import { MaxUint64, Percent } from "@flowx-finance/sdk";

import {
  IncreaseLiquidityOptions,
  DecreaseLiquidityOptions,
  CollectRewardsOptions,
  CollectOptions,
} from "../../types";
import { PositionManager } from "./PositionManager";
import { FLOWX_V3_CONFIG } from "../../constants";
import { Position } from "./Position";
import { getLogger } from "../../utils/Logger";

export class FlowXV3PositionManager implements PositionManager {
  private  readonly logger = getLogger(module);

  openPosition = (position: Position) => (tx: Transaction) => {
    const {
      packageId,
      poolRegistryObject,
      positionRegistryObject,
      versionObject,
    } = FLOWX_V3_CONFIG;
    const [tickLowerI32, tickUpperI32] = [
      tx.moveCall({
        target: `${packageId}::i32::${
          position.tickLower >= 0 ? `from` : `neg_from`
        }`,
        arguments: [tx.pure.u32(Math.abs(position.tickLower))],
      }),
      tx.moveCall({
        target: `${packageId}::i32::${
          position.tickUpper >= 0 ? `from` : `neg_from`
        }`,
        arguments: [tx.pure.u32(Math.abs(position.tickUpper))],
      }),
    ];

    return tx.moveCall({
      target: `${packageId}::position_manager::open_position`,
      typeArguments: [
        position.amountX.coin.coinType,
        position.amountY.coin.coinType,
      ],
      arguments: [
        tx.object(positionRegistryObject),
        tx.object(poolRegistryObject),
        tx.pure.u64(position.pool.fee),
        tickLowerI32,
        tickUpperI32,
        tx.object(versionObject),
      ],
    });
  };

  closePosition = (position: Position) => (tx: Transaction) => {
    const { packageId, positionRegistryObject, versionObject } =
      FLOWX_V3_CONFIG;
    tx.moveCall({
      target: `${packageId}::position_manager::close_position`,
      arguments: [
        tx.object(positionRegistryObject),
        tx.object(position.id),
        tx.object(versionObject),
      ],
    });
  };

  increaseLiquidity =
    (position: Position, options: IncreaseLiquidityOptions) =>
    (tx: Transaction) => {
      const { amountX: amountXDesired, amountY: amountYDesired } =
        position.mintAmounts;

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
      const amountXMin = minimumAmounts.amountX.toString();
      const amountYMin = minimumAmounts.amountY.toString();

      let positionObject: TransactionResult | TransactionArgument;
      if (options.createPosition) {
        positionObject = this.openPosition(position)(tx);
      } else {
        positionObject = tx.object(position.id);
      }

      const [coinXIn, coinYIn] = [
        options.coinXIn ??
          coinWithBalance({
            type: position.amountX.coin.coinType,
            balance: BigInt(amountXDesired.toString()),
            useGasCoin:
              normalizeStructTag(SUI_TYPE_ARG) ===
              normalizeStructTag(position.amountX.coin.coinType),
          }),
        options.coinYIn ??
          coinWithBalance({
            type: position.amountY.coin.coinType,
            balance: BigInt(amountYDesired.toString()),
            useGasCoin:
              normalizeStructTag(SUI_TYPE_ARG) ===
              normalizeStructTag(position.amountY.coin.coinType),
          }),
      ];

      const { packageId, poolRegistryObject, versionObject } = FLOWX_V3_CONFIG;
      tx.moveCall({
        target: `${packageId}::position_manager::increase_liquidity`,
        typeArguments: [
          position.amountX.coin.coinType,
          position.amountY.coin.coinType,
        ],
        arguments: [
          tx.object(poolRegistryObject),
          positionObject,
          coinXIn,
          coinYIn,
          tx.pure.u64(amountXMin),
          tx.pure.u64(amountYMin),
          tx.pure.u64(options.deadline),
          tx.object(versionObject),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });

      if (options.createPosition) {
        return positionObject as TransactionResult;
      }
    };

  decreaseLiquidity =
    (position: Position, options: DecreaseLiquidityOptions) =>
    (tx: Transaction) => {
      this.logger.debug(
        `Decreasing liquidity for position ${position.id} liquidity: ${position.liquidity.toString()}`
      );
      const { amountX: amountXDesired, amountY: amountYDesired } =
        position.mintAmounts;

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

      const amountXMin = minimumAmounts.amountX.toString();
      const amountYMin = minimumAmounts.amountY.toString();

      const { packageId, poolRegistryObject, versionObject } = FLOWX_V3_CONFIG;
      tx.moveCall({
        target: `${packageId}::position_manager::decrease_liquidity`,
        typeArguments: [
          position.amountX.coin.coinType,
          position.amountY.coin.coinType,
        ],
        arguments: [
          tx.object(poolRegistryObject),
          tx.object(position.id),
          tx.pure.u128(position.liquidity.toString()),
          tx.pure.u64(amountXMin),
          tx.pure.u64(amountYMin),
          tx.pure.u64(options.deadline),
          tx.object(versionObject),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });

      const collectResult = tx.moveCall({
        target: `${packageId}::position_manager::collect`,
        typeArguments: [
          position.amountX.coin.coinType,
          position.amountY.coin.coinType,
        ],
        arguments: [
          tx.object(poolRegistryObject),
          tx.object(position.id),
          tx.pure.u64(MaxUint64.toString()),
          tx.pure.u64(MaxUint64.toString()),
          tx.object(versionObject),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });

      return collectResult;
    };

  collect =
    (position: Position, options: CollectOptions) => (tx: Transaction) => {
      const { packageId, poolRegistryObject, versionObject } = FLOWX_V3_CONFIG;

      const collectResult = tx.moveCall({
        target: `${packageId}::position_manager::collect`,
        typeArguments: [
          position.amountX.coin.coinType,
          position.amountY.coin.coinType,
        ],
        arguments: [
          tx.object(poolRegistryObject),
          tx.object(position.id),
          tx.pure.u64(
            options.requestedAmountX?.toString() ?? MaxUint64.toString()
          ),
          tx.pure.u64(
            options?.requestedAmountY?.toString() ?? MaxUint64.toString()
          ),
          tx.object(versionObject),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });

      return collectResult;
    };

  collectReward =
    (position: Position, options: CollectRewardsOptions) =>
    (tx: Transaction) => {
      const { packageId, poolRegistryObject, versionObject } = FLOWX_V3_CONFIG;
      const collectedReward = tx.moveCall({
        target: `${packageId}::position_manager::collect_pool_reward`,
        typeArguments: [
          position.amountX.coin.coinType,
          position.amountY.coin.coinType,
          options.rewardCoin.coinType,
        ],
        arguments: [
          tx.object(poolRegistryObject),
          tx.object(position.id),
          tx.pure.u64(
            options.requestedAmount?.toString() ?? MaxUint64.toString()
          ),
          tx.object(versionObject),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });

      return collectedReward;
    };
}
