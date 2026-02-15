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
  
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('Invalid PRIVATE_KEY format. Must be 0x-prefixed 64 hex chars');
  }
  
  const rpcUrl = getEnvVarWithDefault(
    'RPC_URL',
    'https://fullnode.mainnet.sui.io:443'
  );

  const network = getEnvVarWithDefault('NETWORK', 'mainnet');
  
  const config: BotConfig = {
    privateKey,
    rpcUrl,
    network,
  };
  
  return config;
}

export function validateConfig(config: BotConfig): void {
  // Validate private key format
  if (!config.privateKey.startsWith('0x') || config.privateKey.length !== 66) {
    throw new Error('PRIVATE_KEY must be 0x-prefixed 64 hex chars');
  }

  // Validate network
  const validNetworks = ['mainnet', 'testnet', 'devnet', 'localnet'];
  if (!validNetworks.includes(config.network)) {
    throw new Error(`NETWORK must be one of: ${validNetworks.join(', ')}`);
  }
}
