import { SuiClient, SuiTransactionBlockResponse } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { BotConfig } from '../types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

export class SuiClientService {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private config: BotConfig;
  
  constructor(config: BotConfig) {
    this.config = config;
    this.client = new SuiClient({ url: config.rpcUrl });
    this.keypair = Ed25519Keypair.fromSecretKey(
      Buffer.from(config.privateKey.slice(2), 'hex')
    );
    
    logger.info(`Sui client initialized with RPC: ${config.rpcUrl}`);
    logger.info(`Wallet address: ${this.keypair.getPublicKey().toSuiAddress()}`);
  }
  
  getClient(): SuiClient {
    return this.client;
  }
  
  getKeypair(): Ed25519Keypair {
    return this.keypair;
  }
  
  getAddress(): string {
    return this.keypair.getPublicKey().toSuiAddress();
  }
  
  async executeTransaction(tx: Transaction): Promise<SuiTransactionBlockResponse> {
    try {
      // Clone the transaction for simulation to avoid reuse issues
      const txBytes = await tx.build({ client: this.client });
      
      // Simulate with the built transaction
      await withRetry(
        async () => {
          const result = await this.client.dryRunTransactionBlock({
            transactionBlock: txBytes,
          });
          
          if (result.effects.status.status !== 'success') {
            throw new Error(
              `Transaction simulation failed: ${result.effects.status.error || 'Unknown error'}`
            );
          }
          
          logger.debug('Transaction simulation successful');
        },
        this.config.maxRetries,
        this.config.minRetryDelayMs,
        this.config.maxRetryDelayMs,
        'Transaction simulation'
      );
      
      // Execute the original transaction
      return await withRetry(
        async () => {
          const result = await this.client.signAndExecuteTransaction({
            transaction: tx,
            signer: this.keypair,
            options: {
              showEffects: true,
              showEvents: true,
              showObjectChanges: true,
            },
          });
          
          if (result.effects?.status.status !== 'success') {
            throw new Error(
              `Transaction execution failed: ${result.effects?.status.error || 'Unknown error'}`
            );
          }
          
          logger.info(`Transaction executed successfully: ${result.digest}`);
          return result;
        },
        this.config.maxRetries,
        this.config.minRetryDelayMs,
        this.config.maxRetryDelayMs,
        'Transaction execution'
      );
    } catch (error) {
      logger.error('Transaction execution failed', error);
      throw error;
    }
  }
  
  async getGasPrice(): Promise<bigint> {
    try {
      return await withRetry(
        async () => {
          const gasPrice = await this.client.getReferenceGasPrice();
          return BigInt(gasPrice);
        },
        this.config.maxRetries,
        this.config.minRetryDelayMs,
        this.config.maxRetryDelayMs,
        'Get gas price'
      );
    } catch (error) {
      logger.error('Failed to get gas price', error);
      throw error;
    }
  }
  
  async checkGasPrice(): Promise<void> {
    const gasPrice = await this.getGasPrice();
    
    if (gasPrice > BigInt(this.config.maxGasPrice)) {
      throw new Error(
        `Gas price ${gasPrice} exceeds maximum ${this.config.maxGasPrice}`
      );
    }
    
    logger.debug(`Gas price check passed: ${gasPrice}`);
  }
}
