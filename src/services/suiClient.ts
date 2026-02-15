import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { BotConfig } from '../types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

export class SuiClientService {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  
  constructor(config: BotConfig) {
    this.client = new SuiClient({ url: config.rpcUrl });
    
    // Validate private key format
    if (!config.privateKey.startsWith('0x') || config.privateKey.length !== 66) {
      throw new Error('Invalid private key format: must be 0x-prefixed 64 hex chars');
    }
    
    this.keypair = Ed25519Keypair.fromSecretKey(
      Buffer.from(config.privateKey.slice(2), 'hex')
    );
    
    logger.info(`Sui client initialized with RPC: ${config.rpcUrl}`);
    logger.info(`Wallet address: ${this.keypair.getPublicKey().toSuiAddress()}`);
  }
  
  getClient(): SuiClient {
    return this.client;
  }
  
  getAddress(): string {
    return this.keypair.getPublicKey().toSuiAddress();
  }
  
  /**
   * Get wallet balance for a specific coin type
   * @param coinType The coin type to query (e.g., "0x2::sui::SUI")
   * @returns The total balance for the coin type
   */
  async getWalletBalance(coinType: string): Promise<bigint> {
    try {
      return await withRetry(
        async () => {
          const address = this.getAddress();
          const balance = await this.client.getBalance({
            owner: address,
            coinType: coinType,
          });
          
          logger.debug(`Balance for ${coinType}: ${balance.totalBalance}`);
          return BigInt(balance.totalBalance);
        },
        3, // maxRetries
        1000, // minRetryDelayMs
        30000, // maxRetryDelayMs
        'Get wallet balance'
      );
    } catch (error) {
      logger.error(`Failed to get wallet balance for ${coinType}`, error);
      throw error;
    }
  }

  /**
   * Get all position NFT object IDs owned by the wallet
   * Position NFTs have type containing "::position::Position"
   * @returns Array of position object IDs
   */
  async getWalletPositions(): Promise<string[]> {
    try {
      return await withRetry(
        async () => {
          const address = this.getAddress();
          const result = await this.client.getOwnedObjects({
            owner: address,
            options: {
              showType: true,
              showContent: false,
            },
          });
          
          // Filter objects that are position NFTs
          // Position NFTs have type containing "::position::Position" (case-sensitive)
          const positionIds: string[] = [];
          for (const obj of result.data) {
            if (!obj.data) continue;
            
            const objectType = obj.data.type || '';
            // Use case-sensitive matching for exact type match
            if (objectType.includes('::position::Position')) {
              positionIds.push(obj.data.objectId);
            }
          }
          
          logger.debug(`Found ${positionIds.length} position NFTs in wallet`);
          return positionIds;
        },
        3, // maxRetries
        1000, // minRetryDelayMs
        30000, // maxRetryDelayMs
        'Get wallet positions'
      );
    } catch (error) {
      logger.error('Failed to get wallet positions', error);
      throw error;
    }
  }
}
