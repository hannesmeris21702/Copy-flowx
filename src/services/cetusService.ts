import { initMainnetSDK, CetusClmmSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { SuiClientService } from './suiClient';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';

export class CetusService {
  private sdk: CetusClmmSDK;
  private suiClient: SuiClientService;
  
  constructor(suiClient: SuiClientService, config: BotConfig) {
    this.suiClient = suiClient;
    
    this.sdk = initMainnetSDK(config.rpcUrl, suiClient.getAddress());
    this.sdk.senderAddress = suiClient.getAddress();
    
    logger.info('Cetus SDK initialized');
  }
  
  getSDK(): CetusClmmSDK {
    return this.sdk;
  }
  
  /**
   * Get pool data
   */
  async getPool(poolId: string): Promise<Pool> {
    try {
      const poolData = await this.sdk.Pool.getPool(poolId);
      
      if (!poolData) {
        throw new Error(`Pool ${poolId} not found`);
      }
      
      return {
        id: poolData.poolAddress,
        coinTypeA: this.extractCoinType(poolData.coinTypeA),
        coinTypeB: this.extractCoinType(poolData.coinTypeB),
        currentTick: poolData.current_tick_index,
        tickSpacing: parseInt(poolData.tickSpacing, 10),
      };
    } catch (error) {
      logger.error('Failed to get pool', error);
      throw error;
    }
  }
  
  /**
   * Get all positions with liquidity from wallet
   */
  async getPositionsWithLiquidity(): Promise<Position[]> {
    try {
      const positionIds = await this.suiClient.getWalletPositions();
      
      if (positionIds.length === 0) {
        return [];
      }
      
      logger.info(`Found ${positionIds.length} position NFT(s) in wallet`);
      
      const positions: Position[] = [];
      
      for (const positionId of positionIds) {
        try {
          const positionData = await this.sdk.Position.getPositionById(positionId);
          
          if (!positionData) {
            continue;
          }
          
          const liquidityValue = BigInt(positionData.liquidity);
          if (liquidityValue <= 0n) {
            continue;
          }
          
          positions.push({
            id: positionData.pos_object_id,
            poolId: positionData.pool,
            liquidity: positionData.liquidity,
            coinTypeA: positionData.coin_type_a,
            coinTypeB: positionData.coin_type_b,
            tickLower: positionData.tick_lower_index,
            tickUpper: positionData.tick_upper_index,
          });
        } catch (error) {
          logger.warn(`Error fetching position ${positionId}:`, error);
        }
      }
      
      return positions;
    } catch (error) {
      logger.error('Failed to get positions', error);
      throw error;
    }
  }
  
  /**
   * Check if position is in range
   */
  isPositionInRange(position: Position, currentTick: number): boolean {
    return currentTick >= position.tickLower && currentTick <= position.tickUpper;
  }
  
  /**
   * Calculate new tick range based on current tick and range width
   * 
   * This uses a simplified approach where range width percentage is converted
   * to an approximate tick offset. The multiplier (1000) is an approximation
   * based on typical CLMM tick spacing and price ranges.
   * 
   * Note: This is intentionally simple. The SDK will handle the exact amounts
   * when adding liquidity via zap.
   */
  calculateNewRange(currentTick: number, rangeWidthPercent: number, tickSpacing: number): { tickLower: number; tickUpper: number } {
    // Approximate tick range from percentage
    // Using a simple multiplier for rough tick calculation
    const TICK_APPROXIMATION_MULTIPLIER = 1000;
    const halfRange = Math.floor((rangeWidthPercent / 100) * TICK_APPROXIMATION_MULTIPLIER);
    
    let tickLower = currentTick - halfRange;
    let tickUpper = currentTick + halfRange;
    
    // Round to nearest tick spacing (required by protocol)
    tickLower = Math.floor(tickLower / tickSpacing) * tickSpacing;
    tickUpper = Math.ceil(tickUpper / tickSpacing) * tickSpacing;
    
    return { tickLower, tickUpper };
  }
  
  private extractCoinType(coinType: unknown): string {
    if (typeof coinType === 'string') {
      return coinType;
    }
    
    if (typeof coinType === 'object' && coinType !== null) {
      const ct = coinType as { source_address?: string; full_address?: string; address?: string; module?: string; name?: string };
      
      if (ct.source_address) {
        return ct.source_address;
      }
      
      if (ct.full_address) {
        return ct.full_address;
      }
      
      if (ct.address && ct.module && ct.name) {
        return `${ct.address}::${ct.module}::${ct.name}`;
      }
    }
    
    return String(coinType);
  }
}
