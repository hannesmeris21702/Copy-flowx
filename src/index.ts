import dotenv from 'dotenv';
dotenv.config();

// Initialize Sentry as early as possible for proper error tracking
import { initSentry, captureException, flushSentry } from './utils/sentry';
initSentry();

import { loadConfig, validateConfig } from './config';
import { logger } from './utils/logger';
import { PositionScanner } from './services/positionScanner';
import { RebalancingBot } from './services/rebalancingBot';
import fs from 'fs';
import path from 'path';

const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

async function main(): Promise<void> {
  try {
    // Check if rebalancing mode is enabled
    const enableRebalancing = process.env.ENABLE_REBALANCING === 'true';
    
    if (enableRebalancing) {
      logger.info('=== Cetus CLMM Rebalancing Bot ===');
      logger.warn('⚠️  AUTOMATED REBALANCING ENABLED');
      logger.warn('⚠️  This bot will execute transactions automatically');
    } else {
      logger.info('=== Cetus CLMM Position Scanner ===');
      logger.info('This tool scans your wallet for CLMM positions with liquidity');
      logger.info('No transactions will be executed');
      logger.info('Set ENABLE_REBALANCING=true to enable automated rebalancing');
    }
    
    logger.info('Loading configuration...');
    const config = loadConfig();
    
    logger.info('Validating configuration...');
    validateConfig(config);
    
    logger.info('Configuration loaded successfully');
    
    if (enableRebalancing) {
      // Run rebalancing bot (with transactions)
      const bot = new RebalancingBot(config);
      await bot.start();
      
      // Handle graceful shutdown
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
      
    } else {
      // Run position scanner (read-only)
      const scanner = new PositionScanner(config);
      await scanner.scan();
      
      logger.info('=== Scan Complete ===');
      process.exit(0);
    }
    
  } catch (error) {
    logger.error('Fatal error', error);
    captureException(error);
    await flushSentry();
    process.exit(1);
  }
}

main();
