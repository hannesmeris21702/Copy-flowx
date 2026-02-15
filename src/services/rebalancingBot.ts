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
    logger.info(`Rebalance threshold: ${this.config.rebalanceThresholdPercent}%`);
    logger.info(`Range width: ${this.config.rangeWidthPercent}%`);
    logger.info(`Max slippage: ${this.config.maxSlippagePercent}%`);
    
    // Run first check immediately
    await this.checkAndRebalance();
    
    // Schedule periodic checks
    this.intervalId = setInterval(async () => {
      await this.checkAndRebalance();
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
  
  private async checkAndRebalance(): Promise<void> {
    try {
      logger.info('=== Checking position ===');
      
      // Fetch pool information
      const pool = await this.cetusService.getPool();
      
      logger.info(`Pool: ${pool.id}`);
      logger.info(`Current tick: ${pool.currentTick}`);
      
      // Execute rebalance flow
      // The rebalance service will:
      // 1. Find all wallet positions for this pool
      // 2. Check which positions are out of range
      // 3. Rebalance if needed, or skip if all positions are in range
      await this.rebalanceService.rebalance(pool);
      
      logger.info('✅ Rebalance check completed successfully');
      
    } catch (error) {
      logger.error('Error during check and rebalance', error);
      // Continue running - don't crash the bot on errors
    }
  }
}
