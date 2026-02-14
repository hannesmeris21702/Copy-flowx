import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import { explainError } from '../utils/errorExplainer';
import { setSentryContext, addSentryBreadcrumb, captureException } from '../utils/sentry';
import {
  calculateTickRange,
  tickToSqrtPrice,
  getAmountAFromLiquidity,
  getAmountBFromLiquidity,
} from '../utils/tickMath';

// Fix BigInt JSON serialization
// @ts-expect-error - Extending BigInt prototype for JSON serialization
BigInt.prototype.toJSON = function() { return this.toString(); };

export class RebalanceService {
  private suiClient: SuiClientService;
  private cetusService: CetusService;
  private config: BotConfig;
  
  constructor(
    suiClient: SuiClientService,
    cetusService: CetusService,
    config: BotConfig
  ) {
    this.suiClient = suiClient;
    this.cetusService = cetusService;
    this.config = config;
  }
  
  async rebalance(pool: Pool, position: Position): Promise<void> {
    // Track current stage for error reporting
    let currentStage = 'rebalance_start';
    
    // Set Sentry context with pool and position metadata
    setSentryContext({
      poolId: pool.id,
      positionId: position.id,
      stage: currentStage,
    });
    
    addSentryBreadcrumb('Starting rebalance', 'rebalance', {
      poolId: pool.id,
      positionId: position.id,
      currentTick: pool.currentTick,
      positionRange: `[${position.tickLower}, ${position.tickUpper}]`,
    });
    
    try {
      logger.info('=== Starting Sequential SDK Transaction Rebalance ===');
      
      // Pre-execution validation
      currentStage = 'pre_execution_validation';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      await this.suiClient.checkGasPrice();
      
      // Calculate new range with validated tick spacing
      currentStage = 'calculate_range';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      const newRange = calculateTickRange(
        pool.currentTick,
        this.config.rangeWidthPercent,
        pool.tickSpacing
      );
      
      logger.info(`Current tick: ${pool.currentTick}`);
      logger.info(`Old range: [${position.tickLower}, ${position.tickUpper}]`);
      logger.info(`New range: [${newRange.tickLower}, ${newRange.tickUpper}]`);
      
      addSentryBreadcrumb('Calculated new range', 'rebalance', {
        oldRange: `[${position.tickLower}, ${position.tickUpper}]`,
        newRange: `[${newRange.tickLower}, ${newRange.tickUpper}]`,
      });
      
      // Validate tick spacing alignment
      if (newRange.tickLower % pool.tickSpacing !== 0 || newRange.tickUpper % pool.tickSpacing !== 0) {
        throw new Error('New range ticks not aligned to tick spacing');
      }
      
      // Calculate expected amounts with slippage protection
      currentStage = 'calculate_amounts';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      const expectedAmounts = this.calculateExpectedAmounts(pool, position);
      const slippagePercent = BigInt(Math.floor(this.config.maxSlippagePercent * 100)); // Convert to basis points
      const minAmountA = (expectedAmounts.amountA * (BigInt(10000) - slippagePercent)) / BigInt(10000);
      const minAmountB = (expectedAmounts.amountB * (BigInt(10000) - slippagePercent)) / BigInt(10000);
      
      logger.info(`Expected amounts: A=${expectedAmounts.amountA}, B=${expectedAmounts.amountB}`);
      logger.info(`Min amounts (${this.config.maxSlippagePercent}% slippage): A=${minAmountA}, B=${minAmountB}`);
      
      // Execute sequential transactions using Cetus SDK
      currentStage = 'close_position';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      logger.info('Step 1: Closing old position...');
      await this.closePosition(pool, position, minAmountA, minAmountB);
      logger.info('✅ Old position closed successfully');
      
      // Open new position
      currentStage = 'open_position';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      logger.info('Step 2: Opening new position...');
      const newPositionId = await this.openPosition(pool, newRange);
      logger.info(`✅ New position opened successfully: ${newPositionId}`);
      
      // Add liquidity to new position (if there are coins available)
      if (expectedAmounts.amountA > BigInt(0) || expectedAmounts.amountB > BigInt(0)) {
        currentStage = 'add_liquidity';
        setSentryContext({ poolId: pool.id, positionId: newPositionId, stage: currentStage });
        logger.info('Step 3: Adding liquidity to new position...');
        await this.addLiquidity(pool, newRange, newPositionId);
        logger.info('✅ Liquidity added successfully');
      } else {
        logger.info('⊘ Skipping add liquidity (no coins available)');
      }
      
      addSentryBreadcrumb('Rebalance completed successfully', 'rebalance', {
        newPositionId,
      });
      
      logger.info(`✅ Rebalance successful! New position: ${newPositionId}`);
      logger.info('=== Sequential SDK Transaction Rebalance Complete ===');
      
    } catch (error) {
      // Use error explainer to provide clear guidance
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.error('❌ REBALANCE EXECUTION FAILED');
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      const explained = explainError(error as Error);
      
      if (explained.matched) {
        const explanation = explained.explanation!;
        
        logger.error(`\n📋 ERROR TYPE: ${explained.errorType}`);
        logger.error(`\n📖 EXPLANATION:\n${explanation.description}`);
        
        logger.error(`\n🔍 POSSIBLE CAUSES:`);
        explanation.causes.forEach((cause, idx) => {
          logger.error(`  ${idx + 1}. ${cause}`);
        });
        
        logger.error(`\n💡 SUGGESTED SOLUTIONS:`);
        explanation.fixes.forEach((fix, idx) => {
          logger.error(`  ${idx + 1}. ${fix}`);
        });
        
        if (explanation.examples && explanation.examples.length > 0) {
          logger.error(`\n📝 EXAMPLES:`);
          explanation.examples.forEach(example => {
            logger.error(`  ${example}`);
          });
        }
      } else {
        logger.error(`\n⚠️  Unknown error type - no specific explanation available`);
      }
      
      // Log original error with stack trace
      logger.error(`\n🐛 ORIGINAL ERROR:`);
      logger.error(error as Error);
      
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Capture error in Sentry with pool, position, and current stage context
      captureException(error, {
        poolId: pool.id,
        positionId: position.id,
        stage: currentStage,
      });
      
      // Re-throw the error - don't suppress it
      throw error;
    }
  }
  
  private calculateExpectedAmounts(pool: Pool, position: Position): { amountA: bigint; amountB: bigint } {
    const sqrtPriceCurrent = BigInt(pool.currentSqrtPrice);
    const sqrtPriceLower = tickToSqrtPrice(position.tickLower);
    const sqrtPriceUpper = tickToSqrtPrice(position.tickUpper);
    const liquidity = BigInt(position.liquidity);
    
    // Determine which tokens we'll get based on current price relative to range
    let amountA: bigint;
    let amountB: bigint;
    
    if (sqrtPriceCurrent <= sqrtPriceLower) {
      // Current price below range - all token A
      amountA = getAmountAFromLiquidity(sqrtPriceLower, sqrtPriceUpper, liquidity);
      amountB = BigInt(0);
    } else if (sqrtPriceCurrent >= sqrtPriceUpper) {
      // Current price above range - all token B
      amountA = BigInt(0);
      amountB = getAmountBFromLiquidity(sqrtPriceLower, sqrtPriceUpper, liquidity);
    } else {
      // Current price in range - both tokens
      amountA = getAmountAFromLiquidity(sqrtPriceCurrent, sqrtPriceUpper, liquidity);
      amountB = getAmountBFromLiquidity(sqrtPriceLower, sqrtPriceCurrent, liquidity);
    }
    
    return { amountA, amountB };
  }
  
  
  /**
   * Close old position using Cetus SDK
   * Executes close_position as a separate transaction
   */
  private async closePosition(
    pool: Pool,
    position: Position,
    minAmountA: bigint,
    minAmountB: bigint
  ): Promise<void> {
    const sdk = this.cetusService.getSDK();
    
    // Build the close position transaction using Cetus SDK
    const tx = await sdk.Position.closePositionTransactionPayload({
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      pool_id: pool.id,
      pos_id: position.id,
      min_amount_a: minAmountA.toString(),
      min_amount_b: minAmountB.toString(),
      collect_fee: true, // Also collect fees when closing
      rewarder_coin_types: [], // No rewarder coins for simplicity
    });
    
    // Execute the transaction
    await this.suiClient.executeSDKPayload(tx);
  }
  
  /**
   * Open new position using Cetus SDK
   * Executes open_position as a separate transaction
   * Returns the new position ID
   */
  private async openPosition(
    pool: Pool,
    newRange: { tickLower: number; tickUpper: number }
  ): Promise<string> {
    const sdk = this.cetusService.getSDK();
    
    // Build the open position transaction using Cetus SDK
    const tx = sdk.Position.openPositionTransactionPayload({
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      pool_id: pool.id,
      tick_lower: newRange.tickLower.toString(),
      tick_upper: newRange.tickUpper.toString(),
    });
    
    // Execute the transaction and extract the new position ID from the result
    const result = await this.suiClient.executeSDKPayload(tx);
    
    // Find the created position object from the transaction effects
    const createdObjects = result.effects?.created;
    if (!createdObjects || createdObjects.length === 0) {
      throw new Error('Failed to find created position object');
    }
    
    // The position NFT should be the created object
    // In Cetus, Position objects have a specific type pattern
    const positionObject = createdObjects.find((obj: any) => 
      obj.owner && typeof obj.owner === 'object' && 'AddressOwner' in obj.owner
    );
    
    if (!positionObject) {
      throw new Error('Failed to identify new position NFT in created objects');
    }
    
    return positionObject.reference.objectId;
  }
  
  /**
   * Add liquidity to position using Cetus SDK
   * Executes add_liquidity as a separate transaction
   */
  private async addLiquidity(
    pool: Pool,
    newRange: { tickLower: number; tickUpper: number },
    positionId: string
  ): Promise<void> {
    const sdk = this.cetusService.getSDK();
    
    // Get available coins for the sender - we'll let the SDK handle coin selection
    // Build the add liquidity transaction using Cetus SDK
    const tx = await sdk.Position.createAddLiquidityPayload({
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      pool_id: pool.id,
      pos_id: positionId,
      delta_liquidity: '0', // Let SDK calculate based on coin amounts
      max_amount_a: '18446744073709551615', // Max u64
      max_amount_b: '18446744073709551615', // Max u64
      tick_lower: newRange.tickLower.toString(),
      tick_upper: newRange.tickUpper.toString(),
      collect_fee: false, // Don't collect fees when adding (we just opened this position)
      rewarder_coin_types: [], // No rewarder coins for simplicity
    });
    
    // Execute the transaction
    await this.suiClient.executeSDKPayload(tx);
  }
}
