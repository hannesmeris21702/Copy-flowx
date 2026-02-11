// TODO: ClmmTickMath needs to be implemented
// import { ClmmTickMath } from "@flowx-finance/sdk";
import { Percent } from "./sdkTypes";
import BN from "bn.js";
import invariant from "tiny-invariant";

export class PriceRange {
  priceLower: BN;
  priceUpper: BN;
  bPriceLower: BN;
  bPriceUpper: BN;
  tPriceLower: BN;
  tPriceUpper: BN;

  constructor(
    tickLower: number,
    tickUpper: number,
    bPricePercent: Percent,
    tPricePercent: Percent
  ) {
    this.priceLower = ClmmTickMath.tickIndexToSqrtPriceX64(tickLower);
    this.priceUpper = ClmmTickMath.tickIndexToSqrtPriceX64(tickUpper);
    const priceDiff = this.priceUpper.sub(this.priceLower);

    const bPriceDiff = bPricePercent.multiply(priceDiff).quotient;
    this.bPriceLower = this.priceLower.add(bPriceDiff);
    invariant(this.bPriceLower.lt(this.priceUpper), "invalid bPriceLower");
    this.bPriceUpper = this.priceUpper.sub(bPriceDiff);
    invariant(this.bPriceUpper.gt(this.bPriceLower), "invalid bPriceUpper");

    const tPriceDiff = tPricePercent.multiply(priceDiff).quotient;
    this.tPriceLower = this.priceLower.add(tPriceDiff);
    invariant(this.tPriceLower.lt(this.bPriceUpper), "invalid tPriceLower");
    this.tPriceUpper = this.priceUpper.sub(tPriceDiff);
    invariant(
      this.tPriceUpper.gt(this.tPriceLower) &&
        this.tPriceUpper.lt(this.bPriceUpper),
      "invalid tPriceUpper"
    );
  }
}
