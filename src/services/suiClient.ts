import { SuiClient, SuiTransactionBlockResponse } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { BotConfig } from '../types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { SuiClientErrorDecoder } from 'suiclient-error-decoder';

export class SuiClientService {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private config: BotConfig;
  private decoder: SuiClientErrorDecoder;
  
  constructor(config: BotConfig) {
    this.config = config;
    this.client = new SuiClient({ url: config.rpcUrl });
    
    // Validate private key format
    if (!config.privateKey.startsWith('0x') || config.privateKey.length !== 66) {
      throw new Error('Invalid private key format: must be 0x-prefixed 64 hex chars');
    }
    
    this.keypair = Ed25519Keypair.fromSecretKey(
      Buffer.from(config.privateKey.slice(2), 'hex')
    );
    
    // Initialize error decoder with custom error codes
    this.decoder = new SuiClientErrorDecoder();
    this.decoder.addErrorCodes({
      1001: 'Cetus empty position',
      2001: 'No fees',
      4001: 'close_position 0 coins'
    });
    
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
  
  
  /**
   * Executes an SDK transaction payload
   * This is used for sequential transactions built by Cetus SDK
   * Each transaction is independent and executed separately
   * 
   * @param payload The SDK transaction payload (Transaction object from Cetus SDK methods)
   * @returns Promise resolving to the transaction response
   * @throws Error if transaction fails
   */
  async executeSDKPayload(payload: Transaction): Promise<SuiTransactionBlockResponse> {
    try {
      logger.info('Executing SDK transaction payload...');
      
      // The payload from Cetus SDK should already be a properly formatted transaction
      // We just need to sign and execute it
      const result = await this.client.signAndExecuteTransaction({
        transaction: payload,
        signer: this.keypair,
        options: {
          showEffects: true,
          showEvents: true,
          showObjectChanges: true,
        },
      });
      
      // Verify execution was successful
      if (result.effects?.status.status !== 'success') {
        throw new Error(
          `Transaction execution failed: ${result.effects?.status.error || 'Unknown error'}`
        );
      }
      
      logger.info(`✓ Transaction executed successfully`);
      logger.info(`  Digest: ${result.digest}`);
      
      return result;
    } catch (error) {
      logger.error('Transaction execution failed', error);
      throw error;
    }
  }
  
  async simulateTransaction(tx: Transaction): Promise<void> {
    try {
      await withRetry(
        async () => {
          // Build transaction for simulation
          const txBytes = await tx.build({ client: this.client });
          
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
    } catch (error) {
      logger.error('Transaction simulation failed', error);
      throw error;
    }
  }
  
  async executeTransaction(tx: Transaction): Promise<SuiTransactionBlockResponse> {
    try {
      // First simulate (this builds the transaction)
      await this.simulateTransaction(tx);
      
      // Transaction is now built, cannot execute it
      // This is a fundamental limitation - we cannot both simulate AND execute
      // the same Transaction object
      throw new Error(
        'Cannot execute after simulation: Transaction object can only be built once. ' +
        'Caller must create separate transactions for simulation and execution.'
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
        this.config.maxRetries,
        this.config.minRetryDelayMs,
        this.config.maxRetryDelayMs,
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
          // Position NFTs have type containing "::position::Position"
          const positionIds: string[] = [];
          for (const obj of result.data) {
            if (!obj.data) continue;
            
            const objectType = obj.data.type || '';
            if (objectType.toLowerCase().includes('::position::position')) {
              positionIds.push(obj.data.objectId);
            }
          }
          
          logger.debug(`Found ${positionIds.length} position NFTs in wallet`);
          return positionIds;
        },
        this.config.maxRetries,
        this.config.minRetryDelayMs,
        this.config.maxRetryDelayMs,
        'Get wallet positions'
      );
    } catch (error) {
      logger.error('Failed to get wallet positions', error);
      throw error;
    }
  }
}
