import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import { explainError } from '../utils/errorExplainer';
import { setSentryContext, addSentryBreadcrumb, captureException } from '../utils/sentry';
import { 
  calculateQuoteValue, 
  calculateTickRange, 
  checkSwapRequired, 
  sqrtPriceToPrice, 
  calculateSwapAmount 
} from '../utils/tickMath';
import { 
  logOutOfRangeDetection, 
  logPositionClosed, 
  logWalletBalances, 
  logSwap, 
  logOpenPosition, 
  logAddLiquidity,
  SwapDirection
} from '../utils/botLogger';
import BN from 'bn.js';

// Fix BigInt JSON serialization
// @ts-expect-error - Extending BigInt prototype for JSON serialization
BigInt.prototype.toJSON = function() { return this.toString(); };

// Value-based swap tolerance percentage (1% as per requirements)
const SWAP_VALUE_TOLERANCE_PERCENT = 1;

export class RebalanceService {
  private suiClient: SuiClientService;
  private cetusService: CetusService;
  private config: BotConfig;
  private runtimePositionId?: string; // Runtime-only tracking, never persisted
  
  constructor(
    suiClient: SuiClientService,
    cetusService: CetusService,
    config: BotConfig
  ) {
    this.suiClient = suiClient;
    this.cetusService = cetusService;
    this.config = config;
  }
  
  async rebalance(pool: Pool): Promise<void> {
    let currentStage = 'rebalance_start';
    
    try {
      logger.info('=== Starting Rebalance Flow ===');
      
      // STEP 1: FIND WALLET POSITIONS
      currentStage = 'find_wallet_positions';
      setSentryContext({ poolId: pool.id, stage: currentStage });
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('STEP 1: FIND WALLET POSITIONS');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      const walletPositionIds = await this.suiClient.getWalletPositions();
      logger.info(`Found ${walletPositionIds.length} position NFT(s) in wallet`);
      
      if (walletPositionIds.length === 0) {
        logger.info('No positions found in wallet - nothing to rebalance');
        return;
      }
      
      // Fetch all position data
      const positions: Position[] = [];
      for (const positionId of walletPositionIds) {
        try {
          const sdk = this.cetusService.getSDK();
          const positionData = await sdk.Position.getPositionById(positionId);
          
          if (!positionData) continue;
          
          // Filter: only positions for this pool with liquidity > 0
          if (positionData.pool !== pool.id) continue;
          
          const liquidityValue = BigInt(positionData.liquidity);
          if (liquidityValue <= 0n) continue;
          
          positions.push({
            id: positionData.pos_object_id,
            poolId: positionData.pool,
            tickLower: positionData.tick_lower_index,
            tickUpper: positionData.tick_upper_index,
            liquidity: positionData.liquidity,
            coinA: positionData.coin_type_a,
            coinB: positionData.coin_type_b,
          });
        } catch (error) {
          logger.warn(`Error fetching position ${positionId}:`, error);
        }
      }
      
      logger.info(`Found ${positions.length} position(s) for pool ${pool.id} with liquidity > 0`);
      
      if (positions.length === 0) {
        logger.info('No positions with liquidity > 0 found for this pool - nothing to rebalance');
        return;
      }
      
      // STEP 2: CHECK POSITION RANGE
      currentStage = 'check_position_range';
      setSentryContext({ poolId: pool.id, stage: currentStage });
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('STEP 2: CHECK POSITION RANGE');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info(`Pool current tick: ${pool.currentTick}`);
      
      let outOfRangePosition: Position | null = null;
      
      for (const position of positions) {
        const isInRange = pool.currentTick >= position.tickLower && 
                         pool.currentTick <= position.tickUpper;
        
        logger.info(`Position ${position.id}:`);
        logger.info(`  Range: [${position.tickLower}, ${position.tickUpper}]`);
        logger.info(`  Status: ${isInRange ? 'IN_RANGE (skip)' : 'OUT_OF_RANGE'}`);
        
        if (!isInRange && !outOfRangePosition) {
          outOfRangePosition = position;
          
          // Structured log for out-of-range detection
          logOutOfRangeDetection({
            currentTick: pool.currentTick,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            positionId: position.id,
            liquidity: position.liquidity,
          });
        }
      }
      
      if (!outOfRangePosition) {
        logger.info('All positions are IN_RANGE - no rebalance needed');
        return;
      }
      
      const position = outOfRangePosition;
      logger.info(`Selected position ${position.id} for rebalancing (OUT_OF_RANGE)`);
      
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      
      // STEP 3: CLOSE POSITION
      currentStage = 'close_position';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('STEP 3: CLOSE POSITION');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('Closing out-of-range position...');
      logger.info('  - Remove 100% liquidity');
      logger.info('  - Collect all fees');
      logger.info('  - Close position NFT');
      logger.info('  - Return all tokens to wallet');
      
      await this.suiClient.checkGasPrice();
      const closeResult = await this.closePosition(pool, position);
      
      logPositionClosed({
        positionId: position.id,
        poolId: pool.id,
        success: true,
        transactionDigest: closeResult?.digest,
      });
      
      logger.info('✅ Position closed successfully');
      logger.info('All coins returned to wallet');
      
      // DO NOT reference old position again
      addSentryBreadcrumb('Position closed', 'rebalance', {
        positionId: position.id,
      });
      
      // STEP 4: DETERMINE NEW ACTIVE RANGE
      currentStage = 'determine_new_range';
      setSentryContext({ poolId: pool.id, stage: currentStage });
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('STEP 4: DETERMINE NEW ACTIVE RANGE');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      const newRange = calculateTickRange(
        pool.currentTick,
        this.config.rangeWidthPercent,
        pool.tickSpacing
      );
      
      logger.info(`New range: [${newRange.tickLower}, ${newRange.tickUpper}]`);
      logger.info(`Current tick ${pool.currentTick} is within new range: ${
        pool.currentTick >= newRange.tickLower && pool.currentTick <= newRange.tickUpper ? 'YES' : 'NO'
      }`);
      
      // STEP 5: CALCULATE CLOSED POSITION VALUE
      currentStage = 'calculate_closed_position_value';
      setSentryContext({ poolId: pool.id, stage: currentStage });
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('STEP 5: CALCULATE CLOSED POSITION VALUE');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Read wallet balances AFTER close
      let availableA = await this.suiClient.getWalletBalance(pool.coinTypeA);
      let availableB = await this.suiClient.getWalletBalance(pool.coinTypeB);
      
      logWalletBalances({
        tokenA: {
          type: pool.coinTypeA,
          balance: availableA.toString(),
        },
        tokenB: {
          type: pool.coinTypeB,
          balance: availableB.toString(),
        },
        context: 'After position close',
      });
      
      logger.info('Wallet balances (after close):');
      logger.info(`  Token A: ${availableA}`);
      logger.info(`  Token B: ${availableB}`);
      
      // Convert to single value
      const sqrtPrice = BigInt(pool.currentSqrtPrice);
      const { totalValue: closedPositionValue } = calculateQuoteValue(
        availableA,
        availableB,
        sqrtPrice
      );
      
      logger.info(`Closed position value (in Token B terms): ${closedPositionValue.toFixed(6)}`);
      logger.info('This is the MAX liquidity allowed for the new position');
      
      // STEP 6: CALCULATE REQUIRED AMOUNTS FOR NEW RANGE
      currentStage = 'calculate_required_amounts';
      setSentryContext({ poolId: pool.id, stage: currentStage });
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('STEP 6: CALCULATE REQUIRED AMOUNTS FOR NEW RANGE');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      const swapCheck = checkSwapRequired(
        availableA,
        availableB,
        sqrtPrice,
        newRange.tickLower,
        newRange.tickUpper,
        SWAP_VALUE_TOLERANCE_PERCENT
      );
      
      logger.info('Required amounts for new range:');
      logger.info(`  Token A: ${swapCheck.requiredA}`);
      logger.info(`  Token B: ${swapCheck.requiredB}`);
      logger.info('Available amounts:');
      logger.info(`  Token A: ${availableA}`);
      logger.info(`  Token B: ${availableB}`);
      logger.info(`Ratio mismatch: ${swapCheck.ratioMismatchPercent.toFixed(2)}%`);
      
      // STEP 7: SWAP IF REQUIRED
      currentStage = 'swap_if_required';
      setSentryContext({ poolId: pool.id, stage: currentStage });
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('STEP 7: SWAP IF REQUIRED');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      if (swapCheck.swapRequired) {
        logger.info(`Swap is REQUIRED (mismatch: ${swapCheck.ratioMismatchPercent.toFixed(2)}% > ${SWAP_VALUE_TOLERANCE_PERCENT}%)`);
        logger.info(`Reason: ${swapCheck.reason}`);
        
        const swapDetails = calculateSwapAmount(
          availableA,
          availableB,
          swapCheck.requiredA,
          swapCheck.requiredB,
          sqrtPrice
        );
        
        if (!swapDetails) {
          throw new Error('Failed to calculate swap amount');
        }
        
        logger.info(`Swap direction: ${swapDetails.swapFromA ? 'A → B' : 'B → A'}`);
        logger.info(`Swap amount: ${swapDetails.swapAmount}`);
        
        // Execute swap
        const swapResult = await this.executeSwap(
          pool,
          swapDetails.swapFromA,
          swapDetails.swapAmount,
          this.config.maxSlippagePercent
        );
        
        logSwap({
          direction: swapDetails.swapFromA ? SwapDirection.A_TO_B : SwapDirection.B_TO_A,
          inputAmount: swapDetails.swapAmount.toString(),
          outputAmount: '0', // Not tracked in this context
          transactionDigest: swapResult?.digest,
        });
        
        logger.info('✅ Swap executed successfully');
        
        // Refresh balances after swap
        availableA = await this.suiClient.getWalletBalance(pool.coinTypeA);
        availableB = await this.suiClient.getWalletBalance(pool.coinTypeB);
        
        logger.info('Updated wallet balances (after swap):');
        logger.info(`  Token A: ${availableA}`);
        logger.info(`  Token B: ${availableB}`);
      } else {
        logger.info(`Swap is NOT REQUIRED (mismatch: ${swapCheck.ratioMismatchPercent.toFixed(2)}% <= ${SWAP_VALUE_TOLERANCE_PERCENT}%)`);
        logger.info(`Reason: ${swapCheck.reason}`);
      }
      
      // STEP 8: OPEN NEW POSITION
      currentStage = 'open_new_position';
      setSentryContext({ poolId: pool.id, stage: currentStage });
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('STEP 8 & 9: OPEN NEW POSITION & ADD LIQUIDITY');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // STEP 9: ADD LIQUIDITY
      // Clamp total added value to closedPositionValue * 0.98
      const maxValueToAdd = closedPositionValue * 0.98;
      const { totalValue: currentValue } = calculateQuoteValue(
        availableA,
        availableB,
        sqrtPrice
      );
      
      let finalAmountA = availableA;
      let finalAmountB = availableB;
      
      if (currentValue > maxValueToAdd) {
        // Scale down proportionally
        const scaleFactor = maxValueToAdd / currentValue;
        finalAmountA = BigInt(Math.floor(Number(availableA) * scaleFactor));
        finalAmountB = BigInt(Math.floor(Number(availableB) * scaleFactor));
        
        logger.info(`Clamping liquidity to ${(0.98 * 100).toFixed(0)}% of closed position value`);
        logger.info(`  Scale factor: ${scaleFactor.toFixed(6)}`);
        logger.info(`  Final Token A: ${finalAmountA} (scaled from ${availableA})`);
        logger.info(`  Final Token B: ${finalAmountB} (scaled from ${availableB})`);
      } else {
        logger.info('Using all available tokens (within 98% limit)');
        logger.info(`  Token A: ${finalAmountA}`);
        logger.info(`  Token B: ${finalAmountB}`);
      }
      
      // Validate amounts
      if (finalAmountA === BigInt(0) && finalAmountB === BigInt(0)) {
        throw new Error('Cannot add liquidity: both token amounts are zero');
      }
      
      // Open position and add liquidity atomically
      const atomicResult = await this.openPositionAndAddLiquidity(
        pool,
        newRange.tickLower,
        newRange.tickUpper,
        finalAmountA,
        finalAmountB,
        this.config.maxSlippagePercent
      );
      
      // Save position ID in RUNTIME MEMORY ONLY
      this.runtimePositionId = atomicResult.positionId;
      
      logger.info(`✅ New position created: ${this.runtimePositionId}`);
      logger.info(`✅ Liquidity added successfully`);
      
      logOpenPosition({
        poolId: pool.id,
        positionId: this.runtimePositionId,
        tickLower: newRange.tickLower,
        tickUpper: newRange.tickUpper,
        success: true,
        transactionDigest: atomicResult.digest,
      });
      
      logAddLiquidity({
        positionId: this.runtimePositionId,
        amountA: finalAmountA.toString(),
        amountB: finalAmountB.toString(),
        success: true,
        transactionDigest: atomicResult.digest,
      });
      
      // STEP 10: FINAL SUMMARY
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('REBALANCE COMPLETE');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info(`Old position: ${position.id} (CLOSED)`);
      logger.info(`New position: ${this.runtimePositionId} (OPENED with liquidity)`);
      logger.info(`New range: [${newRange.tickLower}, ${newRange.tickUpper}]`);
      logger.info(`Liquidity added: ${finalAmountA} Token A, ${finalAmountB} Token B`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      addSentryBreadcrumb('Rebalance complete', 'rebalance', {
        oldPositionId: position.id,
        newPositionId: this.runtimePositionId,
        tickLower: newRange.tickLower,
        tickUpper: newRange.tickUpper,
      });
      
    } catch (error) {
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.error('❌ REBALANCE FAILED');
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
      
      logger.error(`\n🐛 ORIGINAL ERROR:`);
      logger.error(error as Error);
      
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      captureException(error, {
        poolId: pool.id,
        stage: currentStage,
      });
      
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
  ): Promise<{ digest?: string }> {
    const sdk = this.cetusService.getSDK();
    
    const tx = await sdk.Position.closePositionTransactionPayload({
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      pool_id: pool.id,
      pos_id: position.id,
      min_amount_a: '0',
      min_amount_b: '0',
      collect_fee: true,
      rewarder_coin_types: [],
    });
    
    const result = await this.suiClient.executeSDKPayload(tx);
    return { digest: result.digest };
  }
  
  /**
   * Execute a token swap using Cetus SDK
   */
  private async executeSwap(
    pool: Pool,
    swapFromA: boolean,
    swapAmount: bigint,
    slippagePercent: number
  ): Promise<{ digest?: string }> {
    const sdk = this.cetusService.getSDK();
    
    logger.info(`Executing swap: ${swapFromA ? 'A → B' : 'B → A'}, amount: ${swapAmount}`);
    
    const slippageFactor = 1 - slippagePercent / 100;
    const amountLimit = BigInt(Math.floor(Number(swapAmount) * slippageFactor));
    
    const tx = await sdk.Swap.createSwapTransactionPayload({
      pool_id: pool.id,
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      a2b: swapFromA,
      by_amount_in: true,
      amount: swapAmount.toString(),
      amount_limit: amountLimit.toString(),
    });
    
    const result = await this.suiClient.executeSDKPayload(tx);
    return { digest: result.digest };
  }
  
  /**
   * Atomically open position AND add liquidity in a single transaction
   */
  private async openPositionAndAddLiquidity(
    pool: Pool,
    tickLower: number,
    tickUpper: number,
    amountA: bigint,
    amountB: bigint,
    slippagePercent: number
  ): Promise<{ positionId: string; digest?: string }> {
    const sdk = this.cetusService.getSDK();
    
    logger.info('Opening new position and adding liquidity atomically...');
    
    // Determine which token to fix
    let fixAmountA: boolean;
    if (amountA === BigInt(0) && amountB > BigInt(0)) {
      fixAmountA = false;
    } else if (amountB === BigInt(0) && amountA > BigInt(0)) {
      fixAmountA = true;
    } else {
      const price = sqrtPriceToPrice(BigInt(pool.currentSqrtPrice));
      const valueA = Number(amountA) * price;
      const valueB = Number(amountB);
      fixAmountA = valueA >= valueB;
    }
    
    const payload = await sdk.Position.createAddLiquidityFixTokenPayload(
      {
        coinTypeA: pool.coinTypeA,
        coinTypeB: pool.coinTypeB,
        pool_id: pool.id,
        tick_lower: tickLower.toString(),
        tick_upper: tickUpper.toString(),
        fix_amount_a: fixAmountA,
        amount_a: amountA.toString(),
        amount_b: amountB.toString(),
        slippage: slippagePercent,
        is_open: true,
        rewarder_coin_types: [],
        collect_fee: false,
        pos_id: '',
      },
      {
        slippage: slippagePercent,
        curSqrtPrice: new BN(pool.currentSqrtPrice),
      }
    );
    
    const result = await this.suiClient.executeSDKPayload(payload);
    
    // Extract position ID from response
    const positionId = this.extractPositionIdFromResponse(result);
    
    if (!positionId) {
      throw new Error('Failed to extract position ID from transaction response');
    }
    
    return { positionId, digest: result.digest };
  }
  
  /**
   * Extract position ID from transaction response
   */
  private extractPositionIdFromResponse(response: any): string | null {
    try {
      const objectChanges = response.objectChanges || [];
      
      for (const change of objectChanges) {
        if (change.type === 'created') {
          const objectType = change.objectType || '';
          if (objectType.toLowerCase().includes('position')) {
            return change.objectId;
          }
        }
      }
      
      const created = response.effects?.created || [];
      if (created.length > 0) {
        const firstCreated = created[0];
        return firstCreated.reference?.objectId || firstCreated.objectId || null;
      }
      
      return null;
    } catch (error) {
      logger.error('Error extracting position ID from response', error);
      return null;
    }
  }
}
