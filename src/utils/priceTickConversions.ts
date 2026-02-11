// TODO: ClmmTickMath needs to be implemented
// import { ClmmTickMath } from "@flowx-finance/sdk";
import { Coin, Price, Q128 } from "./sdkTypes";
import { BigintIsh } from "../constants";
import { BN } from "bn.js";

/**
 * Returns a price object corresponding to the input tick and the base/quote token
 * Inputs must be tokens because the address order is used to interpret the price represented by the tick
 * @param baseCoin the base token of the price
 * @param quoteCoin the quote token of the price
 * @param tick the tick for which to return the price
 */
export function tickToPrice(
  baseCoin: Coin,
  quoteCoin: Coin,
  tick: number
): Price<Coin, Coin> {
  const sqrtRatioX64 = ClmmTickMath.tickIndexToSqrtPriceX64(tick);

  return sqrtPriceX64ToPrice(baseCoin, quoteCoin, sqrtRatioX64);
}

export function sqrtPriceX64ToPrice(
  baseCoin: Coin,
  quoteCoin: Coin,
  sqrtPriceX64: BigintIsh
): Price<Coin, Coin> {
  const ratioX128 = new BN(sqrtPriceX64).mul(new BN(sqrtPriceX64));

  return baseCoin.sortsBefore(quoteCoin)
    ? new Price(baseCoin, quoteCoin, Q128, ratioX128)
    : new Price(baseCoin, quoteCoin, ratioX128, Q128);
}

