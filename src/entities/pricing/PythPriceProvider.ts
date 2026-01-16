import invariant from "tiny-invariant";
import { isNil } from "lodash";

import { PriceProvider } from "./PriceProvider";
import { FetchProviderConnector } from "../connector";
import { cache } from "../../utils/cache";
import { getToken } from "../../utils/tokenHelper";
import { PriceFeedResponse, PriceResponse } from "../../types";
import BigNumber from "bignumber.js";
import { CACHE_CONFIG } from "../../config/cache";

export class PythPriceProvider implements PriceProvider {
  private baseURL = "https://hermes.pyth.network";
  private connector = new FetchProviderConnector();

  async getPrice(token: string): Promise<number> {
    let priceFeedId = cache.get<string>(`price_feed_ids:${token}`);
    if (!priceFeedId) {
      const tokenInfo = await getToken(token);
      const priceFeedRes = await this.connector.get<PriceFeedResponse[]>(
        `${this.baseURL}/v2/price_feeds?query=${tokenInfo.symbol}&asset_type=crypto`,
        {}
      );

      priceFeedId = priceFeedRes.find(
        (feed) => feed.attributes.base === tokenInfo.symbol
      )?.id;
      if (!priceFeedId) {
        return null;
      }

      cache.set(`price_feed_ids:${token}`, priceFeedId, CACHE_CONFIG.PRICE_FEED_ID_TTL);
    }

    const priceRes = await this.connector.get<PriceResponse>(
      `${this.baseURL}/v2/updates/price/latest?ids[]=${priceFeedId}&encoding=base64&parsed=true&ignore_invalid_price_ids=true`,
      {}
    );
    const priceInfo = priceRes.parsed.find((item) => item.id === priceFeedId);
    if (!priceInfo) {
      return null;
    }

    const price = new BigNumber(priceInfo.price.price)
      .multipliedBy(Math.pow(10, priceInfo.price.expo))
      .toNumber();

    return price;
  }
}
