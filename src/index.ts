import dotenv from 'dotenv';
dotenv.config();

import { loadConfig, validateConfig } from './config';
import { logger } from './utils/logger';
import { MonitoringBot } from './services/bot';
import { RebalancingBot } from './services/rebalancingBot';
import fs from 'fs';
import path from 'path';

const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

async function main(): Promise<void> {
  try {
    // Check if rebalancing mode is enabled via environment variable
    const enableRebalancing = process.env.ENABLE_REBALANCING === 'true';
    
    if (enableRebalancing) {
      logger.info('=== Cetus CLMM Atomic Rebalancing Bot ===');
      logger.warn('⚠️  AUTOMATED REBALANCING ENABLED');
      logger.warn('⚠️  This bot will execute transactions automatically');
    } else {
      logger.info('=== Cetus CLMM Position Monitor ===');
      logger.info('NOTE: Monitoring only - no automated trading');
      logger.info('Set ENABLE_REBALANCING=true to enable automated rebalancing');
    }
    
    logger.info('Loading configuration...');
    const config = loadConfig();
    
    logger.info('Validating configuration...');
    validateConfig(config);
    
    logger.info('Configuration loaded successfully');
    
    const bot = enableRebalancing 
      ? new RebalancingBot(config)
      : new MonitoringBot(config);
    
    await bot.start();
    
    process.on('SIGINT', () => {
      logger.info('Received SIGINT signal');
      bot.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM signal');
      bot.stop();
      process.exit(0);
    });
    
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception', error);
      bot.stop();
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason: unknown) => {
      logger.error('Unhandled rejection', { reason });
    });
  } catch (error) {
    logger.error('Fatal error starting bot', error);
    process.exit(1);
  }
}

main();
