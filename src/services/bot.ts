import { BotConfig } from '../types';
import { logger } from '../utils/logger';
import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { MonitorService } from './monitorService';

export class MonitoringBot {
  private config: BotConfig;
  private suiClient: SuiClientService;
  private cetusService: CetusService;
  private monitorService: MonitorService;
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  
  constructor(config: BotConfig) {
    this.config = config;
    this.suiClient = new SuiClientService(config);
    this.cetusService = new CetusService(this.suiClient, config);
    this.monitorService = new MonitorService(this.cetusService, config);
  }
  
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }
    
    this.isRunning = true;
    logger.info('Starting monitoring bot...');
    logger.info('NOTE: This bot only monitors positions, it does not execute trades');
    logger.info(`Check interval: ${this.config.checkIntervalMs}ms`);
    logger.info(`Alert threshold: ${this.config.rebalanceThresholdPercent}%`);
    logger.info(`Suggested range width: ${this.config.rangeWidthPercent}%`);
    
    // Run first check immediately
    await this.checkPosition();
    
    // Schedule periodic checks
    this.intervalId = setInterval(async () => {
      await this.checkPosition();
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
  
  private async checkPosition(): Promise<void> {
    try {
      await this.monitorService.generateReport();
      
      // Report is logged by MonitorService
      // No automated rebalancing - monitoring only
      
    } catch (error) {
      logger.error('Error during position check', error);
    }
  }
}
