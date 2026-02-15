import { initMainnetSDK, CetusClmmSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { SuiClientService } from './suiClient';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

// Type for coin type that may be string or object from Cetus SDK
type CoinTypeValue = string | {
  source_address?: string;
  full_address?: string;
  address?: string;
  module?: string;
  name?: string;
  type?: string;
};

export class CetusService {
  private sdk: CetusClmmSDK;
  private config: BotConfig;
  private suiClient: SuiClientService;
  
  constructor(suiClient: SuiClientService, config: BotConfig) {
    this.config = config;
    this.suiClient = suiClient;
    
    this.sdk = initMainnetSDK(config.rpcUrl, suiClient.getAddress());
    this.sdk.senderAddress = suiClient.getAddress();
    
    logger.info('Cetus SDK initialized');
  }
  
  async getPool(): Promise<Pool> {
    try {
      return await withRetry(
        async () => {
          const poolData = await this.sdk.Pool.getPool(this.config.poolId);
          
          if (!poolData) {
            throw new Error(`Pool ${this.config.poolId} not found`);
          }
          
          // Log the structure to understand the format
          logger.debug('poolData.coinTypeA structure:', JSON.stringify(poolData.coinTypeA));
          logger.debug('poolData.coinTypeB structure:', JSON.stringify(poolData.coinTypeB));
          
          // Extract coin type strings properly
          // If coinTypeA/B are objects, they may have properties like:
          // - source_address (the full type string)
          // - full_address
          // - Or they need to be constructed from address/module/name
          const coinTypeA = this.extractCoinType(poolData.coinTypeA);
          const coinTypeB = this.extractCoinType(poolData.coinTypeB);
          
          logger.debug(`Extracted coinTypeA: ${coinTypeA}`);
          logger.debug(`Extracted coinTypeB: ${coinTypeB}`);
          
          return {
            id: poolData.poolAddress,
            coinTypeA,
            coinTypeB,
            currentSqrtPrice: poolData.current_sqrt_price.toString(),
            currentTick: poolData.current_tick_index,
            tickSpacing: parseInt(poolData.tickSpacing, 10),
            feeRate: poolData.fee_rate,
          };
        },
        this.config.maxRetries,
        this.config.minRetryDelayMs,
        this.config.maxRetryDelayMs,
        'Get pool'
      );
    } catch (error) {
      logger.error('Failed to get pool', error);
      throw error;
    }
  }
  
  private extractCoinType(coinType: CoinTypeValue): string {
    // If it's already a string, return it
    if (typeof coinType === 'string') {
      return coinType;
    }
    
    // If it's an object, extract the type string
    if (typeof coinType === 'object' && coinType !== null) {
      // Try source_address first (most complete form)
      if (coinType.source_address) {
        return coinType.source_address;
      }
      
      // Try full_address
      if (coinType.full_address) {
        return coinType.full_address;
      }
      
      // Construct from address/module/name if available
      if (coinType.address && coinType.module && coinType.name) {
        return `${coinType.address}::${coinType.module}::${coinType.name}`;
      }
      
      // Try type property
      if (coinType.type) {
        return coinType.type;
      }
    }
    
    // Fallback: convert to string (might not be correct, but at least won't crash)
    logger.warn(`Unable to extract coin type from:`, coinType);
    return String(coinType);
  }
  
  async getPosition(): Promise<Position | null> {
    // Scan wallet positions for the pool
    logger.info('Scanning wallet positions...');
    
    try {
      // Get all position NFT IDs from wallet
      const positionIds = await this.suiClient.getWalletPositions();
      
      if (positionIds.length === 0) {
        logger.info('No positions found in wallet');
        return null;
      }
      
      logger.info(`Found ${positionIds.length} position(s) in wallet, checking for pool ${this.config.poolId}...`);
      
      // Fetch all position data in parallel for performance
      const positionDataPromises = positionIds.map(async (positionId) => {
        try {
          const positionData = await this.sdk.Position.getPositionById(positionId);
          return { positionId, positionData };
        } catch (error) {
          logger.warn(`Error fetching position ${positionId}:`, error);
          return { positionId, positionData: null };
        }
      });
      
      const positionResults = await Promise.all(positionDataPromises);
      
      // Find the first position for this pool with liquidity > 0
      for (const { positionId, positionData } of positionResults) {
        if (!positionData) {
          logger.debug(`Position ${positionId} not found, skipping`);
          continue;
        }
        
        // Check if position is for the target pool
        if (positionData.pool !== this.config.poolId) {
          logger.debug(`Position ${positionId} is for pool ${positionData.pool}, skipping`);
          continue;
        }
        
        // Check if position has liquidity
        try {
          const liquidityValue = BigInt(positionData.liquidity);
          if (liquidityValue <= 0n) {
            logger.debug(`Position ${positionId} has no liquidity, skipping`);
            continue;
          }
        } catch (error) {
          logger.warn(`Invalid liquidity value for position ${positionId}: ${positionData.liquidity}`);
          continue;
        }
        
        // Found a valid position!
        logger.info(`✅ Found position ${positionId} for pool with liquidity ${positionData.liquidity}`);
        
        return {
          id: positionData.pos_object_id,
          poolId: positionData.pool,
          tickLower: positionData.tick_lower_index,
          tickUpper: positionData.tick_upper_index,
          liquidity: positionData.liquidity,
          coinA: positionData.coin_type_a,
          coinB: positionData.coin_type_b,
        };
      }
      
      logger.info('No positions found for this pool with liquidity > 0');
      return null;
    } catch (error) {
      logger.error('Failed to scan wallet positions', error);
      throw error;
    }
  }
  
  getSDK(): CetusClmmSDK {
    return this.sdk;
  }
}
