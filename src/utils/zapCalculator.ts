import BN from "bn.js";
import BigNumber from "bignumber.js";
import { BigintIsh, BPS, Fraction, ONE, Percent } from "./sdkTypes";

import { Pool, PriceProvider } from "../entities";

const FLOAT_SCALING = 1_000_000_000;


export class ZapCalculator {
  static async zapAmount({
    pool,
    tickLower,
    tickUpper,
    amount,
    isCoinX,
    priceProvider,
  }: {
    pool: Pool;
    tickLower: number;
    tickUpper: number;
    amount: BigintIsh;
    isCoinX: boolean;
    priceProvider: PriceProvider;
  }): Promise<BN> {
    const [priceX, priceY] = await Promise.all([
      priceProvider.getPrice(pool.coins[0].coinType),
      priceProvider.getPrice(pool.coins[1].coinType),
    ]);

    // The ratio is the proportion between the amount of asset X and the amount of asset Y
    // when adding liquidity to the range [tickLower, tickUpper]
    let ratio = pool
      .getRatio(tickLower, tickUpper)
      .multiply(
        new Fraction(
          new BigNumber(priceY).multipliedBy(FLOAT_SCALING).toFixed(0),
          new BigNumber(priceX).multipliedBy(FLOAT_SCALING).toFixed(0)
        ).divide(
          new Fraction(
            new BN(10).pow(new BN(pool.coins[1].decimals)),
            new BN(10).pow(new BN(pool.coins[0].decimals))
          )
        )
      );

    if (!isCoinX) {
      ratio = new Fraction(ONE).divide(ratio);
    }

    const fraction = ratio
      .multiply(new Percent(1).subtract(new Percent(pool.fee.toString(), BPS)))
      .add(ONE.toString());
    return new BN(amount).sub(
      new BN(new Fraction(amount).divide(fraction).toFixed(0))
    );
  }
}

