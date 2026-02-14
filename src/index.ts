import dotenv from 'dotenv';
dotenv.config();

// Initialize Sentry as early as possible for proper error tracking
import { initSentry, captureException, flushSentry } from './utils/sentry';
initSentry();

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
    
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT signal');
      bot.stop();
      await flushSentry();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM signal');
      bot.stop();
      await flushSentry();
      process.exit(0);
    });
    
    process.on('uncaughtException', async (error: Error) => {
      logger.error('Uncaught exception', error);
      captureException(error);
      await flushSentry();
      bot.stop();
      process.exit(1);
    });
    
    process.on('unhandledRejection', async (reason: unknown) => {
      logger.error('Unhandled rejection', { reason });
      captureException(reason instanceof Error ? reason : new Error(String(reason)));
      await flushSentry();
    });
  } catch (error) {
    logger.error('Fatal error starting bot', error);
    captureException(error);
    await flushSentry();
    process.exit(1);
  }
}

main();
