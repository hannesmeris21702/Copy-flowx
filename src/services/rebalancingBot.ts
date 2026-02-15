import { BotConfig } from '../types';
import { logger } from '../utils/logger';
import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { RebalanceService } from './rebalanceService';

export class RebalancingBot {
  private config: BotConfig;
  private suiClient: SuiClientService;
  private cetusService: CetusService;
  private rebalanceService: RebalanceService;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  
  constructor(config: BotConfig) {
    this.config = config;
    this.suiClient = new SuiClientService(config);
    this.cetusService = new CetusService(this.suiClient, config);
    this.rebalanceService = new RebalanceService(
      this.suiClient,
      this.cetusService,
      config
    );
  }
  
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }
    
    this.isRunning = true;
    logger.info('Starting rebalancing bot...');
    logger.info('⚠️  AUTOMATED REBALANCING ENABLED');
    logger.info(`Check interval: ${this.config.checkIntervalMs}ms`);
    logger.info(`Range width: ${this.config.rangeWidthPercent}%`);
    
    // Run first check immediately
    await this.checkAndRebalancePositions();
    
    // Schedule periodic checks
    this.intervalId = setInterval(async () => {
      await this.checkAndRebalancePositions();
    }, this.config.checkIntervalMs);
    
    logger.info('Bot started successfully');
  }
  
  stop(): void {
    if (!this.isRunning) {
      logger.warn('Bot is not running');
      return;
    }
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isRunning = false;
    logger.info('Bot stopped');
  }
  
  private async checkAndRebalancePositions(): Promise<void> {
    try {
      logger.info('=== Checking positions ===');
      
      // Get all positions with liquidity
      const positions = await this.cetusService.getPositionsWithLiquidity();
      
      if (positions.length === 0) {
        logger.info('No positions with liquidity found');
        return;
      }
      
      logger.info(`Found ${positions.length} position(s) with liquidity`);
      
      // Check and rebalance each position
      for (const position of positions) {
        try {
          // Get pool data for this position
          const pool = await this.cetusService.getPool(position.poolId);
          
          logger.info(`Checking position ${position.id} in pool ${pool.id}`);
          logger.info(`Current tick: ${pool.currentTick}, Position range: [${position.tickLower}, ${position.tickUpper}]`);
          
          // Check and rebalance if needed
          await this.rebalanceService.checkAndRebalance(position, pool);
          
        } catch (error) {
          logger.error(`Error processing position ${position.id}:`, error);
          // Continue with next position
        }
      }
      
      logger.info('✅ Check completed');
      
    } catch (error) {
      logger.error('Error during position check:', error);
      // Don't crash the bot, continue running
    }
  }
}
