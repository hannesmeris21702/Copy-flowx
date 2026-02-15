import dotenv from 'dotenv';
dotenv.config();

// Initialize Sentry as early as possible for proper error tracking
import { initSentry, captureException, flushSentry } from './utils/sentry';
initSentry();

import { loadConfig, validateConfig } from './config';
import { logger } from './utils/logger';
import { PositionScanner } from './services/positionScanner';
import fs from 'fs';
import path from 'path';

const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

async function main(): Promise<void> {
  try {
    logger.info('=== Cetus CLMM Position Scanner ===');
    logger.info('This tool scans your wallet for CLMM positions with liquidity');
    logger.info('No transactions will be executed');
    
    logger.info('Loading configuration...');
    const config = loadConfig();
    
    logger.info('Validating configuration...');
    validateConfig(config);
    
    logger.info('Configuration loaded successfully');
    
    const scanner = new PositionScanner(config);
    await scanner.scan();
    
    logger.info('=== Scan Complete ===');
    process.exit(0);
    
  } catch (error) {
    logger.error('Fatal error', error);
    captureException(error);
    await flushSentry();
    process.exit(1);
  }
}

main();
