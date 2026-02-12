import { initMainnetSDK, CetusClmmSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { SuiClientService } from './suiClient';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

export class CetusService {
  private sdk: CetusClmmSDK;
  private config: BotConfig;
  
  constructor(suiClient: SuiClientService, config: BotConfig) {
    this.config = config;
    
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
  
  private extractCoinType(coinType: any): string {
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
  
  async getPosition(): Promise<Position> {
    try {
      return await withRetry(
        async () => {
          const positionData = await this.sdk.Position.getPositionById(
            this.config.positionId
          );
          
          if (!positionData) {
            throw new Error(`Position ${this.config.positionId} not found`);
          }
          
          return {
            id: positionData.pos_object_id,
            poolId: positionData.pool,
            tickLower: positionData.tick_lower_index,
            tickUpper: positionData.tick_upper_index,
            liquidity: positionData.liquidity,
            coinA: positionData.coin_type_a,
            coinB: positionData.coin_type_b,
          };
        },
        this.config.maxRetries,
        this.config.minRetryDelayMs,
        this.config.maxRetryDelayMs,
        'Get position'
      );
    } catch (error) {
      logger.error('Failed to get position', error);
      throw error;
    }
  }
  
  getSDK(): CetusClmmSDK {
    return this.sdk;
  }
}
