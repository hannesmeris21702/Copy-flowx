import { isNil } from "lodash";
import { PriceProvider } from "./PriceProvider";
import { cache } from "../../utils/cache";

export class CacheablePriceProvider implements PriceProvider {
  private readonly provider: PriceProvider;
  private readonly ttl: number;
  private readonly cacheKeyPrefix: string;

  constructor(provider: PriceProvider, ttl = 60, cacheKeyPrefix = "prices") {
    this.provider = provider;
    this.ttl = ttl;
    this.cacheKeyPrefix = cacheKeyPrefix;
  }

  async getPrice(token: string): Promise<number> {
    const cacheKey = `${this.cacheKeyPrefix}:${token}`;
    const cachedPrice = cache.get<number>(cacheKey);
    
    if (!isNil(cachedPrice)) {
      return cachedPrice;
    }
    
    const price = await this.provider.getPrice(token);
    
    if (!isNil(price)) {
      cache.set(cacheKey, price, this.ttl);
    }
    
    return price;
  }
} 