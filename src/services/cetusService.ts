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
          
          return {
            id: poolData.poolAddress,
            coinTypeA: poolData.coinTypeA,
            coinTypeB: poolData.coinTypeB,
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
