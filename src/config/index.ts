import dotenv from 'dotenv';
import { BotConfig } from '../types';

dotenv.config();

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getEnvVarWithDefault(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export function loadConfig(): BotConfig {
  const privateKey = getEnvVar('PRIVATE_KEY');
  const poolId = getEnvVar('POOL_ID');
  const positionId = getEnvVar('POSITION_ID');
  
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('Invalid PRIVATE_KEY format. Must be 0x-prefixed 64 hex chars');
  }
  
  if (!poolId.startsWith('0x')) {
    throw new Error('Invalid POOL_ID format. Must be 0x-prefixed');
  }
  
  if (!positionId.startsWith('0x')) {
    throw new Error('Invalid POSITION_ID format. Must be 0x-prefixed');
  }
  
  const rpcUrl = getEnvVarWithDefault(
    'RPC_URL',
    'https://fullnode.mainnet.sui.io:443'
  );
  
  const config: BotConfig = {
    privateKey,
    rpcUrl,
    poolId,
    positionId,
    rebalanceThresholdPercent: parseFloat(
      getEnvVarWithDefault('REBALANCE_THRESHOLD_PERCENT', '2.0')
    ),
    rangeWidthPercent: parseFloat(
      getEnvVarWithDefault('RANGE_WIDTH_PERCENT', '5.0')
    ),
    checkIntervalMs: parseInt(
      getEnvVarWithDefault('CHECK_INTERVAL_MS', '60000'),
      10
    ),
    maxSlippagePercent: parseFloat(
      getEnvVarWithDefault('MAX_SLIPPAGE_PERCENT', '1.0')
    ),
    maxGasPrice: parseInt(
      getEnvVarWithDefault('MAX_GAS_PRICE', '1000000000'),
      10
    ),
    minRetryDelayMs: parseInt(
      getEnvVarWithDefault('MIN_RETRY_DELAY_MS', '1000'),
      10
    ),
    maxRetryDelayMs: parseInt(
      getEnvVarWithDefault('MAX_RETRY_DELAY_MS', '30000'),
      10
    ),
    maxRetries: parseInt(getEnvVarWithDefault('MAX_RETRIES', '3'), 10),
    swapRatioTolerancePercent: parseFloat(
      getEnvVarWithDefault('SWAP_RATIO_TOLERANCE_PERCENT', '5.0')
    ),
  };
  
  return config;
}

export function validateConfig(config: BotConfig): void {
  if (config.rebalanceThresholdPercent <= 0 || config.rebalanceThresholdPercent > 100) {
    throw new Error('REBALANCE_THRESHOLD_PERCENT must be between 0 and 100');
  }
  
  if (config.rangeWidthPercent <= 0 || config.rangeWidthPercent > 100) {
    throw new Error('RANGE_WIDTH_PERCENT must be between 0 and 100');
  }
  
  if (config.maxSlippagePercent <= 0 || config.maxSlippagePercent > 100) {
    throw new Error('MAX_SLIPPAGE_PERCENT must be between 0 and 100');
  }
  
  if (config.swapRatioTolerancePercent < 0 || config.swapRatioTolerancePercent > 100) {
    throw new Error('SWAP_RATIO_TOLERANCE_PERCENT must be between 0 and 100');
  }
  
  if (config.checkIntervalMs < 1000) {
    throw new Error('CHECK_INTERVAL_MS must be at least 1000ms');
  }
  
  if (config.maxRetries < 0) {
    throw new Error('MAX_RETRIES must be non-negative');
  }
}
