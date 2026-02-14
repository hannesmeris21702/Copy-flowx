import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import { explainError } from '../utils/errorExplainer';
import { setSentryContext, addSentryBreadcrumb, captureException } from '../utils/sentry';
import { calculateQuoteValue, calculateTickRange, checkSwapRequired, sqrtPriceToPrice, calculateSwapAmount, calculateLiquidityAmounts } from '../utils/tickMath';

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
    
    addSentryBreadcrumb('Starting position closure', 'rebalance', {
      poolId: pool.id,
      positionId: position.id,
      currentTick: pool.currentTick,
      positionRange: `[${position.tickLower}, ${position.tickUpper}]`,
    });
    
    try {
      logger.info('=== Starting Position Closure ===');
      logger.info('Position is OUT_OF_RANGE - closing position and returning all funds to wallet');
      
      // Pre-execution validation
      currentStage = 'pre_execution_validation';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      await this.suiClient.checkGasPrice();
      
      logger.info(`Current tick: ${pool.currentTick}`);
      logger.info(`Position range: [${position.tickLower}, ${position.tickUpper}]`);
      logger.info(`Position liquidity: ${position.liquidity}`);
      
      // Close position - remove 100% liquidity, collect all fees, close NFT
      currentStage = 'close_position';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      logger.info('Closing position...');
      logger.info('  - Removing 100% liquidity');
      logger.info('  - Collecting all fees');
      logger.info('  - Closing position NFT');
      logger.info('  - Returning all coins to wallet');
      
      await this.closePosition(pool, position);
      
      logger.info('✅ Position closed successfully');
      logger.info('All coins have been returned to your wallet');
      
      // Query wallet balances after close_position confirmation
      currentStage = 'query_balances';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      logger.info('Querying wallet balances...');
      
      let availableA = await this.suiClient.getWalletBalance(pool.coinTypeA);
      let availableB = await this.suiClient.getWalletBalance(pool.coinTypeB);
      
      logger.info('=== Wallet Balances (Available Liquidity) ===');
      logger.info(`Token A (${pool.coinTypeA}):`);
      logger.info(`  Available: ${availableA}`);
      logger.info(`Token B (${pool.coinTypeB}):`);
      logger.info(`  Available: ${availableB}`);
      logger.info('These balances are the ONLY liquidity source for new position');
      logger.info('============================================');
      
      // Calculate value using pool price data
      currentStage = 'calculate_value';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      logger.info('Calculating total value using pool price data...');
      
      const sqrtPrice = BigInt(pool.currentSqrtPrice);
      const { valueA, valueB, totalValue } = calculateQuoteValue(
        availableA,
        availableB,
        sqrtPrice
      );
      
      logger.info('=== Portfolio Value (in terms of Token B) ===');
      logger.info(`Value of Token A: ${valueA.toFixed(6)}`);
      logger.info(`Value of Token B: ${valueB.toFixed(6)}`);
      logger.info(`Total Value: ${totalValue.toFixed(6)}`);
      logger.info('This totalValue MUST be preserved when opening new position');
      logger.info('=============================================');
      
      // Calculate new range for potential position reopening
      currentStage = 'calculate_new_range';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      logger.info('Calculating new position range...');
      
      const newRange = calculateTickRange(
        pool.currentTick,
        this.config.rangeWidthPercent,
        pool.tickSpacing
      );
      
      logger.info(`New range calculated: [${newRange.tickLower}, ${newRange.tickUpper}]`);
      
      // Check if swap is required
      currentStage = 'check_swap_required';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      logger.info('Checking if swap is required...');
      
      const swapCheck = checkSwapRequired(
        availableA,
        availableB,
        sqrtPrice,
        newRange.tickLower,
        newRange.tickUpper,
        this.config.swapRatioTolerancePercent
      );
      
      logger.info('=== Swap Requirement Analysis ===');
      logger.info(`Optimal Ratio (A/B): ${swapCheck.optimalRatio === Infinity ? 'Infinity (only A needed)' : swapCheck.optimalRatio.toFixed(6)}`);
      logger.info(`Available Ratio (A/B): ${swapCheck.availableRatio === Infinity ? 'Infinity (only A available)' : swapCheck.availableRatio.toFixed(6)}`);
      logger.info(`Ratio Mismatch: ${swapCheck.ratioMismatchPercent.toFixed(2)}%`);
      logger.info(`Tolerance: ${this.config.swapRatioTolerancePercent}%`);
      logger.info(`Swap Required: ${swapCheck.swapRequired ? 'YES' : 'NO'}`);
      logger.info(`Reason: ${swapCheck.reason}`);
      logger.info('=================================');
      
      // Execute swap if required
      if (swapCheck.swapRequired) {
        currentStage = 'execute_swap';
        setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
        logger.info('Swap is required - executing swap...');
        
        // Calculate swap amount
        const currentPrice = sqrtPriceToPrice(sqrtPrice);
        const swapDetails = calculateSwapAmount(
          availableA,
          availableB,
          swapCheck.optimalRatio,
          currentPrice
        );
        
        if (!swapDetails) {
          logger.error('Unable to calculate swap amount');
          throw new Error('Failed to calculate swap amount to achieve optimal ratio');
        }
        
        logger.info('=== Swap Details ===');
        logger.info(`Direction: ${swapDetails.swapFromA ? 'Token A → Token B' : 'Token B → Token A'}`);
        logger.info(`Swap Amount: ${swapDetails.swapAmount}`);
        logger.info(`Expected Output: ${swapDetails.expectedOutput}`);
        logger.info('====================');
        
        // Execute swap
        await this.executeSwap(
          pool,
          swapDetails.swapFromA,
          swapDetails.swapAmount,
          this.config.maxSlippagePercent
        );
        
        addSentryBreadcrumb('Swap executed', 'rebalance', {
          positionId: position.id,
          swapFromA: swapDetails.swapFromA,
          swapAmount: swapDetails.swapAmount.toString(),
          expectedOutput: swapDetails.expectedOutput.toString(),
        });
        
        // Refresh wallet balances after swap
        currentStage = 'refresh_balances_after_swap';
        setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
        logger.info('Refreshing wallet balances after swap...');
        
        availableA = await this.suiClient.getWalletBalance(pool.coinTypeA);
        availableB = await this.suiClient.getWalletBalance(pool.coinTypeB);
        
        logger.info('=== Updated Wallet Balances ===');
        logger.info(`Token A: ${availableA}`);
        logger.info(`Token B: ${availableB}`);
        
        // Recalculate value after swap
        const { valueA: newValueA, valueB: newValueB, totalValue: newTotalValue } = calculateQuoteValue(
          availableA,
          availableB,
          sqrtPrice
        );
        
        logger.info('=== Updated Portfolio Value ===');
        logger.info(`Value of Token A: ${newValueA.toFixed(6)}`);
        logger.info(`Value of Token B: ${newValueB.toFixed(6)}`);
        logger.info(`Total Value: ${newTotalValue.toFixed(6)}`);
        logger.info(`Value preserved: ${Math.abs(newTotalValue - totalValue) < 0.01 * totalValue ? 'YES' : 'NO (within slippage)'}`);
        logger.info('================================');
        
        addSentryBreadcrumb('Balances refreshed after swap', 'rebalance', {
          positionId: position.id,
          newAvailableA: availableA.toString(),
          newAvailableB: availableB.toString(),
          newTotalValue: newTotalValue.toString(),
        });
      } else {
        logger.info('No swap required - token ratio is acceptable');
      }
      
      // Open new position
      currentStage = 'open_position';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      logger.info('Opening new position...');
      
      const newPositionId = await this.openPosition(
        pool,
        newRange.tickLower,
        newRange.tickUpper
      );
      
      logger.info('=== New Position Created ===');
      logger.info(`Position ID: ${newPositionId}`);
      logger.info(`Tick range: [${newRange.tickLower}, ${newRange.tickUpper}]`);
      logger.info('============================');
      
      addSentryBreadcrumb('New position opened', 'rebalance', {
        oldPositionId: position.id,
        newPositionId: newPositionId,
        tickLower: newRange.tickLower,
        tickUpper: newRange.tickUpper,
      });
      
      // Add liquidity to the new position
      currentStage = 'add_liquidity';
      setSentryContext({ poolId: pool.id, positionId: newPositionId, stage: currentStage });
      
      // Calculate optimal liquidity amounts
      // This ensures we don't exceed available balances and leave dust if needed
      // Use the current availableA and availableB (already updated if swap was executed)
      const liquidityAmounts = calculateLiquidityAmounts(
        availableA,
        availableB,
        sqrtPrice,
        newRange.tickLower,
        newRange.tickUpper
      );
      
      logger.info('Adding liquidity to position...');
      logger.info(`  Using Token A: ${liquidityAmounts.amountA.toString()}`);
      logger.info(`  Using Token B: ${liquidityAmounts.amountB.toString()}`);
      
      // Add liquidity to the position
      await this.addLiquidity(
        newPositionId,
        pool,
        liquidityAmounts.amountA,
        liquidityAmounts.amountB,
        this.config.maxSlippagePercent
      );
      
      // Refresh balances to show what's left (dust)
      const dustA = await this.suiClient.getWalletBalance(pool.coinTypeA);
      const dustB = await this.suiClient.getWalletBalance(pool.coinTypeB);
      
      logger.info('=== Final Wallet Balances (After Liquidity) ===');
      logger.info(`Token A (${pool.coinTypeA.substring(0, 20)}...): ${dustA.toString()} (dust remaining)`);
      logger.info(`Token B (${pool.coinTypeB.substring(0, 20)}...): ${dustB.toString()} (dust remaining)`);
      logger.info('=================================================');
      
      // Calculate final portfolio value to verify preservation
      const { totalValue: liquidityTotalValue } = calculateQuoteValue(
        liquidityAmounts.amountA,
        liquidityAmounts.amountB,
        sqrtPrice
      );
      
      const { totalValue: dustTotalValue } = calculateQuoteValue(
        dustA,
        dustB,
        sqrtPrice
      );
      
      const finalTotalValue = liquidityTotalValue + dustTotalValue;
      
      logger.info('=== Final Portfolio Value ===');
      logger.info(`Value in Position: ${liquidityTotalValue.toFixed(6)}`);
      logger.info(`Value in Wallet (dust): ${dustTotalValue.toFixed(6)}`);
      logger.info(`Total Value: ${finalTotalValue.toFixed(6)}`);
      logger.info(`Original Total Value: ${totalValue.toFixed(6)}`);
      
      // Check if value is preserved (within 1% tolerance to account for slippage and rounding)
      const valuePreserved = Math.abs(finalTotalValue - totalValue) < 0.01 * totalValue;
      logger.info(`Value Preserved: ${valuePreserved ? 'YES' : 'NO (within 1% tolerance)'}`);
      logger.info('==============================');
      
      addSentryBreadcrumb('Liquidity added to position', 'rebalance', {
        positionId: newPositionId,
        amountA: liquidityAmounts.amountA.toString(),
        amountB: liquidityAmounts.amountB.toString(),
        dustA: dustA.toString(),
        dustB: dustB.toString(),
        finalTotalValue: finalTotalValue.toString(),
        originalTotalValue: totalValue.toString(),
        valuePreserved: valuePreserved,
      });
      
      addSentryBreadcrumb('Wallet balances queried', 'rebalance', {
        positionId: position.id,
        availableA: availableA.toString(),
        availableB: availableB.toString(),
        valueA: valueA.toString(),
        valueB: valueB.toString(),
        totalValue: totalValue.toString(),
      });
      
      addSentryBreadcrumb('Swap requirement checked', 'rebalance', {
        positionId: position.id,
        swapRequired: swapCheck.swapRequired,
        optimalRatio: swapCheck.optimalRatio.toString(),
        availableRatio: swapCheck.availableRatio.toString(),
        ratioMismatchPercent: swapCheck.ratioMismatchPercent.toString(),
        newRangeLower: newRange.tickLower,
        newRangeUpper: newRange.tickUpper,
      });
      
      addSentryBreadcrumb('Position closed successfully', 'rebalance', {
        positionId: position.id,
      });
      
      logger.info('=== Rebalance Complete ===');
      logger.info(`Old Position: ${position.id} (CLOSED)`);
      logger.info(`New Position: ${newPositionId} (OPENED with liquidity)`);
      logger.info('===========================');

      
    } catch (error) {
      // Use error explainer to provide clear guidance
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.error('❌ POSITION CLOSURE FAILED');
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
  
  /**
   * Close position using Cetus SDK
   * Removes 100% liquidity, collects all fees, and closes position NFT
   * All coins are returned to wallet
   */
  private async closePosition(
    pool: Pool,
    position: Position
  ): Promise<void> {
    const sdk = this.cetusService.getSDK();
    
    // Build the close position transaction using Cetus SDK
    // Set min_amount_a and min_amount_b to '0' to remove 100% liquidity
    const tx = await sdk.Position.closePositionTransactionPayload({
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      pool_id: pool.id,
      pos_id: position.id,
      min_amount_a: '0', // Remove 100% liquidity - no minimum
      min_amount_b: '0', // Remove 100% liquidity - no minimum
      collect_fee: true, // Collect all fees
      rewarder_coin_types: [], // No rewarder coins
    });
    
    // Execute the transaction and wait for confirmation
    // Coins are automatically returned to wallet (no return value capture)
    await this.suiClient.executeSDKPayload(tx);
  }
  
  /**
   * Execute a token swap using Cetus SDK
   * Swaps tokens to achieve optimal ratio for new position
   */
  private async executeSwap(
    pool: Pool,
    swapFromA: boolean,
    swapAmount: bigint,
    slippagePercent: number
  ): Promise<void> {
    const sdk = this.cetusService.getSDK();
    
    logger.info('Executing swap...');
    logger.info(`  Direction: ${swapFromA ? 'A → B' : 'B → A'}`);
    logger.info(`  Amount: ${swapAmount}`);
    logger.info(`  Slippage: ${slippagePercent}%`);
    
    // Calculate amount limit based on slippage
    // For swap in, we get less output so we need minimum output
    // amount_limit = expectedOutput * (1 - slippage)
    const slippageFactor = 1 - slippagePercent / 100;
    const amountLimit = BigInt(Math.floor(Number(swapAmount) * slippageFactor));
    
    // Build the swap transaction using Cetus SDK
    // a2b = true means swap A to B, false means swap B to A
    const tx = await sdk.Swap.createSwapTransactionPayload({
      pool_id: pool.id,
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      a2b: swapFromA,
      by_amount_in: true,
      amount: swapAmount.toString(),
      amount_limit: amountLimit.toString(),
    });
    
    // Execute the transaction and wait for confirmation
    await this.suiClient.executeSDKPayload(tx);
    
    logger.info('✅ Swap executed successfully');
  }
  
  /**
   * Open a new position using Cetus SDK
   * Creates position NFT without adding liquidity
   * @returns The position ID (NFT object ID)
   */
  private async openPosition(
    pool: Pool,
    tickLower: number,
    tickUpper: number
  ): Promise<string> {
    const sdk = this.cetusService.getSDK();
    
    logger.info('Opening new position...');
    logger.info(`  Tick range: [${tickLower}, ${tickUpper}]`);
    logger.info(`  Pool: ${pool.id}`);
    
    // Build the open position transaction using Cetus SDK
    // This creates the position NFT without adding liquidity
    const tx = await sdk.Position.openPositionTransactionPayload({
      pool_id: pool.id,
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      tick_lower: tickLower.toString(),
      tick_upper: tickUpper.toString(),
    });
    
    // Execute the transaction and wait for confirmation
    const result = await this.suiClient.executeSDKPayload(tx);
    
    // Extract position ID (NFT) from transaction response
    // The position NFT is created as a new object
    const positionId = this.extractPositionIdFromResponse(result);
    
    if (!positionId) {
      throw new Error('Failed to extract position ID from transaction response');
    }
    
    logger.info('✅ Position opened successfully');
    logger.info(`  Position ID: ${positionId}`);
    
    return positionId;
  }
  
  /**
   * Extract position ID from transaction response
   * Looks for newly created position NFT object
   */
  private extractPositionIdFromResponse(
    response: any
  ): string | null {
    try {
      // Check objectChanges for created objects
      const objectChanges = response.objectChanges || [];
      
      // Find the created position NFT
      // Position NFTs are created with type containing "Position" or "position"
      for (const change of objectChanges) {
        if (change.type === 'created') {
          const objectType = change.objectType || '';
          
          // Check if this is a position NFT
          // Cetus position NFTs typically have type like: "0x...::position::Position"
          if (objectType.toLowerCase().includes('position')) {
            return change.objectId;
          }
        }
      }
      
      // Fallback: check effects.created
      const created = response.effects?.created || [];
      if (created.length > 0) {
        // Return the first created object (likely the position NFT)
        const firstCreated = created[0];
        return firstCreated.reference?.objectId || firstCreated.objectId || null;
      }
      
      return null;
    } catch (error) {
      logger.error('Error extracting position ID from response', error);
      return null;
    }
  }
  
  /**
   * Add liquidity to a position
   * Uses wallet coin balances and respects available amounts
   * 
   * @param positionId The position NFT ID
   * @param pool The pool information
   * @param amountA Amount of token A to add
   * @param amountB Amount of token B to add
   * @param slippagePercent Slippage tolerance percentage
   */
  private async addLiquidity(
    positionId: string,
    pool: Pool,
    amountA: bigint,
    amountB: bigint,
    slippagePercent: number
  ): Promise<void> {
    const sdk = this.cetusService.getSDK();
    
    logger.info('Adding liquidity to position...');
    logger.info(`  Position ID: ${positionId}`);
    logger.info(`  Amount A: ${amountA.toString()}`);
    logger.info(`  Amount B: ${amountB.toString()}`);
    logger.info(`  Slippage: ${slippagePercent}%`);
    
    // Convert slippage from percentage (e.g., 1.0 for 1%) to basis points (100 bps)
    const slippageBps = Math.floor(slippagePercent * 100);
    
    // Build the add liquidity transaction using Cetus SDK
    // fix_amount_a=true means we use the specified amount_a and let amount_b adjust
    const tx = await sdk.Position.addLiquidityTransactionPayload({
      position_id: positionId,
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      amount_a: amountA.toString(),
      amount_b: amountB.toString(),
      fix_amount_a: true,  // Fix amount A, allow B to adjust within slippage
      slippage_tolerance_bps: slippageBps,
      is_open: true,  // true for newly opened positions, false for existing positions
      rewarder_coin_types: [],  // No rewarders for now
    });
    
    // Execute the transaction and wait for confirmation
    await this.suiClient.executeSDKPayload(tx);
    
    logger.info('✅ Liquidity added successfully');
  }
}
