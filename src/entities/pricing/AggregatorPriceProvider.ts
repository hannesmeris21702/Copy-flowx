import { isNil, isNumber } from "lodash";
import invariant from "tiny-invariant";

import { PriceProvider } from "./PriceProvider";
import { PythPriceProvider } from "./PythPriceProvider";
import { FlowXPriceProvider } from "./FlowXPriceProvider";
import { CacheablePriceProvider } from "./CacheablePriceProvider";
import { cache } from "../../utils/cache";
import { CACHE_CONFIG } from "../../config/cache";
import winston from "winston";

export class AggregatorPriceProvider implements PriceProvider {
  private readonly priceProviders: {
    provider: PriceProvider;
    weight: number;
  }[] = [];

  constructor() {
    this.priceProviders = [
      {
        provider: new CacheablePriceProvider(
          new PythPriceProvider(),
          CACHE_CONFIG.PYTH_PRICE_TTL,
          "prices:pyth"
        ),
        weight: 8,
      },
      {
        provider: new CacheablePriceProvider(
          new FlowXPriceProvider(),
          CACHE_CONFIG.FLOWX_PRICE_TTL,
          "prices:flowx"
        ),
        weight: 2,
      },
    ];
  }

  async getPrice(token: string): Promise<number> {
    const prices = await Promise.all(
      this.priceProviders.map(({ provider }) => provider.getPrice(token))
    );

    const totalPrice = prices.reduce(
      (acc, price, idx) =>
        acc +
        this.priceProviders[idx].weight *
          (isNumber(price) && price > 0 ? price : 0),
      0
    );
    const totalWeight = prices.reduce(
      (acc, price, idx) =>
        acc +
        (isNumber(price) && price > 0 ? this.priceProviders[idx].weight : 0),
      0
    );
    invariant(totalWeight > 0, "No price available");
    const price = totalPrice / totalWeight;
    invariant(price > 0, "Invalid price");

    return price;
  }
}
