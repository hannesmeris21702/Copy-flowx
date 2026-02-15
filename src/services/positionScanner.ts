import { initMainnetSDK, CetusClmmSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { SuiClientService } from './suiClient';
import { BotConfig, Position } from '../types';
import { logger } from '../utils/logger';

export class PositionScanner {
  private sdk: CetusClmmSDK;
  private suiClient: SuiClientService;
  
  constructor(config: BotConfig) {
    this.suiClient = new SuiClientService(config);
    
    this.sdk = initMainnetSDK(config.rpcUrl, this.suiClient.getAddress());
    this.sdk.senderAddress = this.suiClient.getAddress();
    
    logger.info('Cetus SDK initialized');
  }
  
  async scan(): Promise<void> {
    logger.info('=== Scanning Wallet for CLMM Positions ===');
    
    try {
      // Get all position NFT IDs from wallet
      const positionIds = await this.suiClient.getWalletPositions();
      
      if (positionIds.length === 0) {
        logger.info('✓ No CLMM positions found in wallet');
        logger.info('  Your wallet does not contain any position NFTs');
        return;
      }
      
      logger.info(`Found ${positionIds.length} position NFT(s) in wallet`);
      logger.info('Checking positions for liquidity...\n');
      
      // Fetch all position data in parallel
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
      
      // Filter positions with liquidity > 0
      const positionsWithLiquidity: Position[] = [];
      
      for (const { positionId, positionData } of positionResults) {
        if (!positionData) {
          logger.debug(`Position ${positionId} not found, skipping`);
          continue;
        }
        
        // Check if position has liquidity
        try {
          const liquidityValue = BigInt(positionData.liquidity);
          if (liquidityValue <= 0n) {
            logger.debug(`Position ${positionId} has no liquidity, skipping`);
            continue;
          }
          
          positionsWithLiquidity.push({
            id: positionData.pos_object_id,
            poolId: positionData.pool,
            liquidity: positionData.liquidity,
            coinTypeA: positionData.coin_type_a,
            coinTypeB: positionData.coin_type_b,
          });
        } catch (error) {
          logger.warn(`Invalid liquidity value for position ${positionId}: ${positionData.liquidity}`);
          continue;
        }
      }
      
      // Display results
      if (positionsWithLiquidity.length === 0) {
        logger.info('✓ No positions with active liquidity found');
        logger.info('  All positions in your wallet have 0 liquidity');
      } else {
        logger.info(`✓ Found ${positionsWithLiquidity.length} position(s) with active liquidity:\n`);
        
        for (const position of positionsWithLiquidity) {
          logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          logger.info(`Position ID: ${position.id}`);
          logger.info(`Pool ID:     ${position.poolId}`);
          logger.info(`Liquidity:   ${position.liquidity}`);
          logger.info(`Coin A:      ${this.formatCoinType(position.coinTypeA)}`);
          logger.info(`Coin B:      ${this.formatCoinType(position.coinTypeB)}`);
          logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        }
      }
      
    } catch (error) {
      logger.error('Failed to scan wallet positions', error);
      throw error;
    }
  }
  
  private formatCoinType(coinType: string): string {
    // Shorten long coin types for readability
    if (coinType.length > 60) {
      const parts = coinType.split('::');
      if (parts.length >= 3 && parts[0]) {
        return `${parts[0].substring(0, 10)}...::${parts[1]}::${parts[2]}`;
      }
    }
    return coinType;
  }
}
