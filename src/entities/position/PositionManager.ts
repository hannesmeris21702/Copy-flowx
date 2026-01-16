import { Transaction, TransactionResult } from "@mysten/sui/transactions";

import {
  CollectOptions,
  CollectRewardsOptions,
  DecreaseLiquidityOptions,
  IncreaseLiquidityOptions,
} from "../../types";
import { Position } from "./Position";

export interface PositionManager {
  openPosition(
    position: Position
  ): (tx: Transaction) => TransactionResult | void;

  increaseLiquidity(
    position: Position,
    options: IncreaseLiquidityOptions
  ): (tx: Transaction) => void | TransactionResult;

  decreaseLiquidity(
    position: Position,
    options: DecreaseLiquidityOptions
  ): (tx: Transaction) => TransactionResult;

  collect(
    position: Position,
    options: CollectOptions
  ): (tx: Transaction) => TransactionResult;

  collectReward(
    position: Position,
    options: CollectRewardsOptions
  ): (tx: Transaction) => TransactionResult;

  closePosition(position: Position): (tx: Transaction) => void;
}
