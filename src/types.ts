import { Coin, Percent } from "./utils/sdkTypes";
import { TransactionArgument } from "@mysten/sui/transactions";
import { BigintIsh, ClmmProtocol } from "./constants";

export type MoveObject<T> = {
  fields: T;
  type: string;
};

export type ID = {
  id: string;
};

export type MoveTypeName = {
  name: string;
};

export type MoveInteger = {
  bits: number;
};

// Pyth price feed types
export type PriceFeedResponse = {
  id: string;
  attributes: Attributes;
};

export type Attributes = {
  asset_type: string;
  base: string;
  description: string;
  display_symbol: string;
  generic_symbol: string;
  quote_currency: string;
  schedule: string;
  symbol: string;
};

export type PriceResponse = {
  binary: Binary;
  parsed: Parsed[];
};

export type Binary = {
  encoding: string;
  data: string[];
};

export type Parsed = {
  id: string;
  price: Price;
  ema_price: Price;
  metadata: Metadata;
};

export type Price = {
  price: string;
  conf: string;
  expo: number;
  publish_time: number;
};

export type Metadata = {
  slot: number;
  proof_available_time: number;
  prev_publish_time: number;
};

// Position and liquidity operation types
export type LiquidityOperationOptions = {
  slippageTolerance: Percent;
  deadline: number;
};

export type IncreaseLiquidityOptions = {
  coinXIn?: TransactionArgument;
  coinYIn?: TransactionArgument;
  createPosition?: boolean;
} & LiquidityOperationOptions;

export type DecreaseLiquidityOptions = LiquidityOperationOptions;

export type CollectOptions = {
  requestedAmountX?: BigintIsh;
  requestedAmountY?: BigintIsh;
};

export type CollectRewardsOptions = {
  rewardCoin: Coin;
  requestedAmount?: BigintIsh;
};
