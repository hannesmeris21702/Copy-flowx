// Cache TTL values in seconds
export const CACHE_CONFIG = {
  // Price caching
  PYTH_PRICE_TTL: 60,
  FLOWX_PRICE_TTL: 60,
  
  // Price feed ID caching (0 = no expiry)
  PRICE_FEED_ID_TTL: 0,
  
  // Token metadata caching (0 = no expiry)
  TOKEN_METADATA_TTL: 0,
}; 