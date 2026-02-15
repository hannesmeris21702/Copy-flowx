import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import { SuiTransactionBlockResponse } from '@mysten/sui/client';

export class RebalanceService {
  private suiClient: SuiClientService;
  private cetusService: CetusService;
  private config: BotConfig;
  
  constructor(
    suiClient: SuiClientService,
    cetusService: CetusService,
    config: BotConfig
  ) {
    this.suiClient = suiClient;
    this.cetusService = cetusService;
    this.config = config;
  }
  
  /**
   * Extract position ID from transaction result
   */
  private extractPositionIdFromResult(result: SuiTransactionBlockResponse): string | null {
    // Look for created objects in the transaction
    if (result.objectChanges) {
      for (const change of result.objectChanges) {
        if (change.type === 'created' && change.objectType.includes('::position::Position')) {
          return change.objectId;
        }
      }
    }
    return null;
  }
  
  /**
   * Check and rebalance a position if it's out of range
   * Simple zap-based approach with no custom calculations
   */
  async checkAndRebalance(position: Position, pool: Pool): Promise<void> {
    const inRange = this.cetusService.isPositionInRange(position, pool.currentTick);
    
    if (inRange) {
      logger.info(`Position ${position.id}: IN_RANGE - No action needed`);
      return;
    }
    
    logger.warn(`Position ${position.id}: OUT_OF_RANGE - Rebalancing...`);
    
    try {
      // Step 1: Close position (remove 100% liquidity)
      logger.info('Step 1: Closing position and removing liquidity...');
      const closePayload = await this.cetusService.getSDK().Position.closePositionTransactionPayload({
        coinTypeA: position.coinTypeA,
        coinTypeB: position.coinTypeB,
        pool_id: position.poolId,
        pos_id: position.id,  // Changed from position_id to pos_id
        min_amount_a: '0',  // Accept any amount (SDK handles this)
        min_amount_b: '0',
        rewarder_coin_types: [],
        collect_fee: true,
      });
      
      const closeResult = await this.suiClient.executeTransaction(closePayload);
      logger.info('✓ Position closed successfully');
      logger.debug(`Close transaction digest: ${closeResult.digest}`);
      
      // Step 2: Calculate new range based on current price
      logger.info('Step 2: Calculating new range...');
      const newRange = this.cetusService.calculateNewRange(
        pool.currentTick,
        this.config.rangeWidthPercent,
        pool.tickSpacing
      );
      logger.info(`New range: [${newRange.tickLower}, ${newRange.tickUpper}]`);
      
      // Step 3: Open new position and add liquidity
      // For opening new positions, we use SDK's openPositionTransactionPayload
      // followed by addLiquidityFixTokenPayload
      logger.info('Step 3: Opening new position...');
      
      const openPositionPayload = await this.cetusService.getSDK().Position.openPositionTransactionPayload({
        coinTypeA: position.coinTypeA,
        coinTypeB: position.coinTypeB,
        pool_id: position.poolId,
        tick_lower: newRange.tickLower.toString(),
        tick_upper: newRange.tickUpper.toString(),
      });
      
      const openPositionResult = await this.suiClient.executeTransaction(openPositionPayload);
      logger.info('✓ New position opened');
      logger.debug(`Open position transaction digest: ${openPositionResult.digest}`);
      
      // Extract the new position ID from the transaction result
      const newPositionId = this.extractPositionIdFromResult(openPositionResult);
      if (!newPositionId) {
        throw new Error('Failed to extract new position ID from transaction');
      }
      logger.info(`New position ID: ${newPositionId}`);
      
      // Step 4: Add liquidity using zap (SDK handles token swap internally)
      logger.info('Step 4: Adding liquidity with zap...');
      
      // Get wallet balances to determine how much we can add
      const balanceA = await this.suiClient.getWalletBalance(position.coinTypeA);
      const balanceB = await this.suiClient.getWalletBalance(position.coinTypeB);
      
      logger.debug(`Available balances: A=${balanceA}, B=${balanceB}`);
      
      // Use all available balance from the closed position
      const addLiquidityPayload = await this.cetusService.getSDK().Position.createAddLiquidityFixTokenPayload({
        coinTypeA: position.coinTypeA,
        coinTypeB: position.coinTypeB,
        pool_id: position.poolId,
        pos_id: newPositionId,
        tick_lower: newRange.tickLower.toString(),
        tick_upper: newRange.tickUpper.toString(),
        fix_amount_a: true,
        amount_a: balanceA.toString(),
        amount_b: balanceB.toString(),
        is_open: false, // Position is already open
        slippage: 0.01, // 1% slippage tolerance
        collect_fee: false,
        rewarder_coin_types: [],
      });
      
      const addLiquidityResult = await this.suiClient.executeTransaction(addLiquidityPayload);
      logger.info('✓ New position opened and liquidity added via zap');
      logger.debug(`Add liquidity transaction digest: ${addLiquidityResult.digest}`);
      
      logger.info('✅ Rebalance completed successfully');
      
    } catch (error) {
      logger.error('❌ Rebalance failed:', error);
      logger.error('Position has been closed but new position was not created.');
      logger.error('Manual intervention required:');
      logger.error('1. Check wallet balances for returned tokens');
      logger.error('2. Manually create a new position via Cetus UI');
      logger.error('3. Or wait for the next rebalance cycle to retry');
      throw error;
    }
  }
}
