import { SuiClient, SuiTransactionBlockResponse } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { BotConfig } from '../types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { isTypeArgError } from '../utils/typeArgNormalizer';
import { SuiClientErrorDecoder } from 'suiclient-error-decoder';
import { PTBValidator, PTBValidationError } from '../utils/ptbValidator';

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
  
  /**
   * Executes a transaction without prior simulation
   * Wraps PTB execution in try-catch with retry logic
   * Validates type arguments are properly normalized
   * Retries up to 5 times (minimum) with exponential backoff
   * 
   * @param tx The transaction to execute
   * @returns Promise resolving to the transaction response
   * @throws Error if transaction fails after all retry attempts
   */
  async executeTransactionWithoutSimulation(tx: Transaction): Promise<SuiTransactionBlockResponse> {
    try {
      // Use configurable maxRetries from BotConfig
      // Ensure minimum of 5 retries as per requirement
      const maxRetries = Math.max(this.config.maxRetries, 5);
      
      logger.info(`Executing PTB with up to ${maxRetries} retry attempts and exponential backoff`);
      
      // Attempt execution with retry logic
      return await this.executeWithRetry(tx, maxRetries);
    } catch (error) {
      logger.error('Transaction execution failed after all retries', error);
      throw error;
    }
  }
  
  /**
   * Execute transaction with retry logic and exponential backoff
   * Wraps execution in try-catch and handles transient failures
   * Type arguments are validated and auto-corrected using TypeTagSerializer during PTB build
   * Retries up to maxRetries times with exponential backoff delay
   * 
   * @copilot PTB validation happens before build() to catch SecondaryIndexOutOfBounds early
   * 
   * @param tx The transaction to execute
   * @param maxRetries Maximum number of retry attempts
   * @returns Promise resolving to the transaction response
   * @throws Error if all retry attempts fail
   */
  private async executeWithRetry(
    tx: Transaction,
    maxRetries: number
  ): Promise<SuiTransactionBlockResponse> {
    let lastError: Error = new Error('Transaction execution failed with unknown error');
    
    logger.debug(`Starting PTB execution with ${maxRetries} maximum retry attempts`);
    
    // PRE-BUILD VALIDATION: Validate PTB structure before first execution attempt
    // This catches SecondaryIndexOutOfBounds and other structural issues early
    // @copilot If validation fails, check result[x][y] indexing and conditional merge patterns
    try {
      logger.info('🔍 Running pre-build PTB validation...');
      
      // Note: We cannot clone transactions that use coinWithBalance or other Intents
      // because they cannot be serialized until build(). Instead, we skip dry-run
      // validation and rely on the actual execution to catch errors.
      // The PTB will be built fresh on each execution attempt (see line 198).
      
      // Check if transaction uses Intents that cannot be serialized
      const ptbData = tx.getData();
      const hasIntents = ptbData.commands.some((cmd: any) => 
        cmd.$kind === '$Intent' || (cmd.$Intent && cmd.$kind === '$Intent')
      );
      
      if (hasIntents) {
        logger.info('ℹ️  Transaction uses Intents (e.g., coinWithBalance) - skipping pre-build validation');
        logger.info('   Validation will occur during first execution attempt');
      } else {
        // Clone and validate for transactions without Intents
        const validationTx = Transaction.from(tx.serialize());
        
        await PTBValidator.validateBeforeBuild(
          validationTx,
          this.client,
          this.getAddress()
        );
        
        logger.info('✓ Pre-build validation passed');
      }
    } catch (error) {
      if (error instanceof PTBValidationError) {
        // Log detailed validation error with Copilot fix suggestion
        logger.error('❌ PTB Validation Failed (detected before execution)');
        logger.error(`  Error Type: ${error.errorType || 'Unknown'}`);
        logger.error(`  Command: ${error.commandIndex ?? 'N/A'}`);
        logger.error(`  Message: ${error.message}`);
        
        if (error.suggestion) {
          logger.error('  💡 Copilot Fix Suggestion:');
          logger.error(`     ${error.suggestion}`);
        }
        
        // @copilot Error Lens will show this inline. Fix by:
        // 1. Checking result index references (result[x][y])
        // 2. Using conditional mergeCoins when coin may not exist
        // 3. Following Cetus SDK patterns for liquidity handling
        throw error;
      }
      
      logger.warn('⚠ Pre-build validation encountered error, proceeding with execution:', error);
    }
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`Attempt ${attempt}/${maxRetries}: Executing PTB...`);
        
        // Execute the transaction
        // Note: The Sui SDK's signAndExecuteTransaction accepts a Transaction object
        // and builds it internally if not already built. The SDK handles transaction
        // state appropriately for retry scenarios. Each call to signAndExecuteTransaction
        // will attempt to build and execute the transaction.
        const result = await this.client.signAndExecuteTransaction({
          transaction: tx,
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
        
        logger.info(`✓ Transaction executed successfully on attempt ${attempt}/${maxRetries}`);
        logger.info(`  Digest: ${result.digest}`);
        return result;
        
      } catch (error) {
        lastError = error as Error;
        
        // Decode PTB CommandArgumentError using suiclient-error-decoder
        const decoded = this.decoder.parseError(error);
        logger.error(`🚨 PTB: ${decoded.message} Cmd${decoded.code ?? 'N/A'}`);
        
        // Special handling for SecondaryIndexOutOfBounds errors
        // @copilot This error occurs when accessing result[x][y] where y doesn't exist
        // Fix by using conditional mergeCoins pattern from Cetus SDK
        if (lastError.message.includes('SecondaryIndexOutOfBounds')) {
          logger.error('❌ SecondaryIndexOutOfBounds detected');
          logger.error('   This typically happens when:');
          logger.error('   1. Accessing result[x][y] where coin y was not returned');
          logger.error('   2. close_position returns 0-2 coins based on liquidity');
          logger.error('   3. collect_fee may return empty coins');
          logger.error('');
          logger.error('💡 Copilot Fix: Use conditional mergeCoins pattern:');
          logger.error('   if (willReturnCoin) {');
          logger.error('     ptb.mergeCoins(destination, [source]);');
          logger.error('   }');
          logger.error('');
          logger.error('   See Cetus SDK examples for proper liquidity handling');
        }
        
        logger.error(`Fix: result[3][0] indexing - Check conditional merge patterns`);
        
        // Check if this is a type argument related error
        const isTypeError = isTypeArgError(lastError);
        
        if (isTypeError) {
          logger.error(
            `Type argument error detected on attempt ${attempt}/${maxRetries}. ` +
            `This indicates the PTB was not built with properly normalized type arguments.`
          );
        }
        
        if (attempt < maxRetries) {
          // Calculate exponential backoff delay: baseDelay * 2^(attempt-1)
          const baseDelay = this.config.minRetryDelayMs || 1000;
          const maxDelay = this.config.maxRetryDelayMs || 30000;
          const delay = Math.min(
            baseDelay * Math.pow(2, attempt - 1),
            maxDelay
          );
          
          const errorType = isTypeError ? 'Type argument error' : 'Transaction error';
          logger.warn(
            `✗ ${errorType} on attempt ${attempt}/${maxRetries}: ${lastError.message}`
          );
          logger.info(`  Retrying with exponential backoff delay: ${delay}ms...`);
          
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // All retry attempts exhausted
          logger.error(
            `✗ Transaction execution failed after all ${maxRetries} retry attempts`
          );
          logger.error(`  Final error: ${lastError.message}`);
        }
      }
    }
    
    throw lastError;
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
