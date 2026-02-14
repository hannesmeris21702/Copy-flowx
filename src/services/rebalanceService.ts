import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { BotConfig, Pool, Position, RebalanceState } from '../types';
import { logger } from '../utils/logger';
import { explainError } from '../utils/errorExplainer';
import { setSentryContext, addSentryBreadcrumb, captureException } from '../utils/sentry';
import { calculateQuoteValue, calculateTickRange, checkSwapRequired, sqrtPriceToPrice, calculateSwapAmount, applySafetyBuffers, getAmountsForLiquidity, determinePricePosition, PricePosition } from '../utils/tickMath';
import { StateManager } from '../utils/stateManager';
import { 
  logOutOfRangeDetection, 
  logPositionClosed, 
  logWalletBalances, 
  logSwap, 
  logOpenPosition, 
  logAddLiquidity,
  SwapDirection
} from '../utils/botLogger';

// Fix BigInt JSON serialization
// @ts-expect-error - Extending BigInt prototype for JSON serialization
BigInt.prototype.toJSON = function() { return this.toString(); };

export class RebalanceService {
  private suiClient: SuiClientService;
  private cetusService: CetusService;
  private config: BotConfig;
  private stateManager: StateManager;
  currentPositionId?: string;
  
  constructor(
    suiClient: SuiClientService,
    cetusService: CetusService,
    config: BotConfig
  ) {
    this.suiClient = suiClient;
    this.cetusService = cetusService;
    this.config = config;
    this.stateManager = new StateManager(config.stateFilePath);
  }
  
  async rebalance(pool: Pool, position: Position): Promise<void> {
    // Track current stage for error reporting
    let currentStage = 'rebalance_start';
    
    // Load existing state (if any) for resume capability
    const existingState = this.stateManager.loadState();
    let resumeState: RebalanceState = RebalanceState.MONITORING;
    let stateData: any = {};
    
    if (existingState) {
      // Validate that we're resuming the same position
      if (existingState.positionId !== position.id || existingState.poolId !== pool.id) {
        logger.warn('State file exists but for different position/pool - starting fresh');
        logger.warn(`  State: ${existingState.positionId} vs Current: ${position.id}`);
        this.stateManager.clearState();
      } else {
        resumeState = existingState.state;
        stateData = existingState.data || {};
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        logger.info('🔄 RESUMING FROM SAVED STATE');
        logger.info(`   Current State: ${resumeState}`);
        logger.info(`   Saved at: ${existingState.timestamp}`);
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      }
    }
    
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
      resumeState: resumeState,
    });
    
    try {
      logger.info('=== Starting Position Closure ===');
      logger.info('Position is OUT_OF_RANGE - closing position and returning all funds to wallet');
      
      // Structured log for out-of-range detection
      logOutOfRangeDetection({
        currentTick: pool.currentTick,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        positionId: position.id,
        liquidity: position.liquidity.toString(),
      });
      
      // Pre-execution validation
      currentStage = 'pre_execution_validation';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      await this.suiClient.checkGasPrice();
      
      logger.info(`Current tick: ${pool.currentTick}`);
      logger.info(`Position range: [${position.tickLower}, ${position.tickUpper}]`);
      logger.info(`Position liquidity: ${position.liquidity}`);
      
      // Variables to track throughout rebalance
      let availableA: bigint;
      let availableB: bigint;
      let totalValue: number;
      let closedPositionValue: number; // Value after close_position
      let newRange: { tickLower: number; tickUpper: number };
      let newPositionId: string;
      const sqrtPrice = BigInt(pool.currentSqrtPrice);
      
      // Close position - remove 100% liquidity, collect all fees, close NFT
      // Skip if already completed (state >= POSITION_CLOSED)
      if (this.stateManager.isStateCompleted(resumeState, RebalanceState.POSITION_CLOSED)) {
        logger.info('⏭️  SKIPPING: Position already closed (resuming from saved state)');
        
        // Restore data from saved state
        availableA = BigInt(stateData.availableA || '0');
        availableB = BigInt(stateData.availableB || '0');
        totalValue = parseFloat(stateData.totalValue || '0');
        closedPositionValue = parseFloat(stateData.closedPositionValue || stateData.totalValue || '0');
        
        logger.info(`   Restored availableA: ${availableA}`);
        logger.info(`   Restored availableB: ${availableB}`);
        logger.info(`   Restored totalValue: ${totalValue}`);
        logger.info(`   Restored closedPositionValue: ${closedPositionValue}`);
      } else {
        currentStage = 'close_position';
        setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
        logger.info('Closing position...');
        logger.info('  - Removing 100% liquidity');
        logger.info('  - Collecting all fees');
        logger.info('  - Closing position NFT');
        logger.info('  - Returning all coins to wallet');
        
        const closeResult = await this.closePosition(pool, position);
        
        // Structured log for position closure
        logPositionClosed({
          positionId: position.id,
          poolId: pool.id,
          success: true,
          transactionDigest: closeResult?.digest,
        });
        
        logger.info('✅ Position closed successfully');
        logger.info('All coins have been returned to your wallet');
        
        // Query wallet balances after close_position confirmation
        currentStage = 'query_balances';
        setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
        logger.info('Querying wallet balances...');
        
        availableA = await this.suiClient.getWalletBalance(pool.coinTypeA);
        availableB = await this.suiClient.getWalletBalance(pool.coinTypeB);
        
        // Structured log for wallet balances
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
        
        const { valueA, valueB, totalValue: calcTotalValue } = calculateQuoteValue(
          availableA,
          availableB,
          sqrtPrice
        );
        
        totalValue = calcTotalValue;
        closedPositionValue = calcTotalValue; // Store value immediately after close
        
        logger.info('=== Portfolio Value (in terms of Token B) ===');
        logger.info(`Value of Token A: ${valueA.toFixed(6)}`);
        logger.info(`Value of Token B: ${valueB.toFixed(6)}`);
        logger.info(`Total Value: ${totalValue.toFixed(6)}`);
        logger.info(`Closed Position Value: ${closedPositionValue.toFixed(6)}`);
        logger.info('This closedPositionValue will be used as reference for liquidity re-add');
        logger.info('=============================================');
        
        // Save state: POSITION_CLOSED
        this.stateManager.saveState({
          state: RebalanceState.POSITION_CLOSED,
          positionId: position.id,
          poolId: pool.id,
          timestamp: new Date().toISOString(),
          data: {
            availableA: availableA.toString(),
            availableB: availableB.toString(),
            totalValue: totalValue.toString(),
            closedPositionValue: closedPositionValue.toString(),
          },
        });
      }
      
      // Calculate new range for potential position reopening
      currentStage = 'calculate_new_range';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      logger.info('Calculating new position range...');
      
      newRange = stateData.tickLower && stateData.tickUpper 
        ? { tickLower: stateData.tickLower, tickUpper: stateData.tickUpper }
        : calculateTickRange(
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
      // Skip if already completed (state >= SWAP_COMPLETED)
      if (this.stateManager.isStateCompleted(resumeState, RebalanceState.SWAP_COMPLETED)) {
        logger.info('⏭️  SKIPPING: Swap already completed (resuming from saved state)');
        
        // Restore data from saved state  
        if (stateData.swapExecuted) {
          availableA = BigInt(stateData.availableA || '0');
          availableB = BigInt(stateData.availableB || '0');
          
          logger.info(`   Restored availableA: ${availableA}`);
          logger.info(`   Restored availableB: ${availableB}`);
        }
        
        // Restore closedPositionValue from state
        closedPositionValue = parseFloat(stateData.closedPositionValue || '0');
      } else if (swapCheck.swapRequired) {
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
        const swapResult = await this.executeSwap(
          pool,
          swapDetails.swapFromA,
          swapDetails.swapAmount,
          this.config.maxSlippagePercent
        );
        
        // Structured log for swap execution (reuse currentPrice from above)
        logSwap({
          direction: swapDetails.swapFromA ? SwapDirection.A_TO_B : SwapDirection.B_TO_A,
          reason: swapCheck.reason,
          inputAmount: swapDetails.swapAmount.toString(),
          outputAmount: swapDetails.expectedOutput.toString(),
          price: currentPrice.toFixed(6),
          slippage: this.config.maxSlippagePercent.toString(),
          transactionDigest: swapResult?.digest,
        });
        
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
        
        // Save state: SWAP_COMPLETED
        this.stateManager.saveState({
          state: RebalanceState.SWAP_COMPLETED,
          positionId: position.id,
          poolId: pool.id,
          timestamp: new Date().toISOString(),
          data: {
            availableA: availableA.toString(),
            availableB: availableB.toString(),
            totalValue: totalValue.toString(),
            closedPositionValue: closedPositionValue.toString(),
            tickLower: newRange.tickLower,
            tickUpper: newRange.tickUpper,
            swapExecuted: true,
          },
        });
      } else {
        logger.info('No swap required - token ratio is acceptable');
        
        // Save state: SWAP_COMPLETED (even though no swap was done)
        this.stateManager.saveState({
          state: RebalanceState.SWAP_COMPLETED,
          positionId: position.id,
          poolId: pool.id,
          timestamp: new Date().toISOString(),
          data: {
            availableA: availableA.toString(),
            availableB: availableB.toString(),
            totalValue: totalValue.toString(),
            closedPositionValue: closedPositionValue.toString(),
            tickLower: newRange.tickLower,
            tickUpper: newRange.tickUpper,
            swapExecuted: false,
          },
        });
      }
      
      // Open new position
      // Skip if already completed (state >= POSITION_OPENED)
      if (this.stateManager.isStateCompleted(resumeState, RebalanceState.POSITION_OPENED)) {
        logger.info('⏭️  SKIPPING: Position already opened (resuming from saved state)');
        
        // Restore data from saved state
        newPositionId = stateData.newPositionId || '';
        
        logger.info(`   Restored newPositionId: ${newPositionId}`);
        
        if (!newPositionId) {
          throw new Error('State indicates position opened but newPositionId not found in state data');
        }
      } else {
        currentStage = 'open_position';
        setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
        logger.info('Opening new position...');
        
        const openResult = await this.openPosition(
          pool,
          newRange.tickLower,
          newRange.tickUpper
        );
        
        newPositionId = openResult.positionId;
        
        // Assign and log the new runtime position ID
        this.currentPositionId = openResult.positionId;
        logger.info(`Using new runtime position ID: ${this.currentPositionId}`);
        
        // Structured log for position opening
        logOpenPosition({
          poolId: pool.id,
          positionId: newPositionId,
          tickLower: newRange.tickLower,
          tickUpper: newRange.tickUpper,
          success: true,
          transactionDigest: openResult.digest,
        });
        
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
        
        // Save state: POSITION_OPENED
        this.stateManager.saveState({
          state: RebalanceState.POSITION_OPENED,
          positionId: position.id,
          poolId: pool.id,
          timestamp: new Date().toISOString(),
          data: {
            availableA: availableA.toString(),
            availableB: availableB.toString(),
            totalValue: totalValue.toString(),
            tickLower: newRange.tickLower,
            tickUpper: newRange.tickUpper,
            newPositionId: newPositionId,
            swapExecuted: stateData.swapExecuted || false,
          },
        });
      }
      
      // Add liquidity to the new position
      // Skip if already completed (state >= LIQUIDITY_ADDED)
      if (this.stateManager.isStateCompleted(resumeState, RebalanceState.LIQUIDITY_ADDED)) {
        logger.info('⏭️  SKIPPING: Liquidity already added (resuming from saved state)');
        logger.info('   Rebalance was already completed - clearing state');
        
        // Clear state and return
        this.stateManager.clearState();
        
        logger.info('=== Rebalance Already Complete ===');
        logger.info(`Old Position: ${position.id} (CLOSED)`);
        logger.info(`New Position: ${newPositionId} (OPENED with liquidity)`);
        logger.info('===================================');
        
        return;
      }
      
      currentStage = 'add_liquidity';
      setSentryContext({ poolId: pool.id, positionId: newPositionId, stage: currentStage });
      
      // =====================================================================
      // CLMM ADD LIQUIDITY ENFORCEMENT LOGIC (SDK-based)
      // =====================================================================
      
      // Step 1: Fetch current pool price and determine price position
      logger.info('=== Step 1: Determine Price Position ===');
      const currentPrice = sqrtPriceToPrice(sqrtPrice);
      const pricePosition = determinePricePosition(sqrtPrice, newRange.tickLower, newRange.tickUpper);
      logger.info(`Current Pool Price: ${currentPrice.toFixed(6)}`);
      logger.info(`Price Position: ${pricePosition}`);
      logger.info('========================================');
      
      // Step 2: Calculate target liquidity value
      logger.info('=== Step 2: Determine Target Liquidity Value ===');
      const { totalValue: availableValue } = calculateQuoteValue(
        availableA,
        availableB,
        sqrtPrice
      );
      const targetLiquidityValue = Math.min(closedPositionValue, availableValue);
      logger.info(`Closed Position Value: ${closedPositionValue.toFixed(6)}`);
      logger.info(`Available Value: ${availableValue.toFixed(6)}`);
      logger.info(`Target Liquidity Value: ${targetLiquidityValue.toFixed(6)}`);
      logger.info('=================================================');
      
      // Step 3: Get required amounts using CLMM math
      logger.info('=== Step 3: Calculate Required Amounts (CLMM Math) ===');
      const { requiredA, requiredB } = getAmountsForLiquidity(
        targetLiquidityValue,
        sqrtPrice,
        newRange.tickLower,
        newRange.tickUpper
      );
      logger.info(`Required Token A: ${requiredA.toString()}`);
      logger.info(`Required Token B: ${requiredB.toString()}`);
      logger.info('========================================================');
      
      // Step 4: Handle INSIDE position - may need to swap to get correct ratio
      let walletA = availableA;
      let walletB = availableB;
      
      if (pricePosition === PricePosition.INSIDE) {
        logger.info('=== Step 4: Handle INSIDE Position (Swap if needed) ===');
        logger.info(`Wallet Token A: ${walletA.toString()}`);
        logger.info(`Wallet Token B: ${walletB.toString()}`);
        
        // Check if we need to swap
        if (walletA < requiredA) {
          // Need more A, swap B -> A
          const shortfallA = requiredA - walletA;
          // Convert price to bigint ratio for precise calculation
          // swapAmountB = shortfallA * price, where price is in terms of B per A
          // Add 10% buffer to account for slippage and price impact
          const priceScaled = BigInt(Math.floor(currentPrice * 1000000)); // Scale by 1M for precision
          const swapAmountB = (shortfallA * priceScaled) / BigInt(1000000);
          const bufferedSwapB = (swapAmountB * BigInt(110)) / BigInt(100); // 10% buffer
          
          logger.info(`⚠️  Insufficient Token A: need ${requiredA.toString()}, have ${walletA.toString()}`);
          logger.info(`Shortfall: ${shortfallA.toString()}`);
          logger.info(`Swapping ${bufferedSwapB.toString()} of Token B -> A (with 10% buffer)`);
          
          // Execute swap B -> A
          await this.executeSwap(
            pool,
            false, // swapFromA = false means B -> A
            bufferedSwapB,
            this.config.maxSlippagePercent
          );
          
          // Re-read wallet balances after swap
          walletA = await this.suiClient.getWalletBalance(pool.coinTypeA);
          walletB = await this.suiClient.getWalletBalance(pool.coinTypeB);
          
          logger.info(`After swap - Wallet A: ${walletA.toString()}, Wallet B: ${walletB.toString()}`);
        } else if (walletB < requiredB) {
          // Need more B, swap A -> B
          const shortfallB = requiredB - walletB;
          // Convert 1/price to bigint ratio for precise calculation
          // swapAmountA = shortfallB / price
          // Add 10% buffer to account for slippage and price impact
          const inversePriceScaled = BigInt(Math.floor((1 / currentPrice) * 1000000)); // Scale by 1M
          const swapAmountA = (shortfallB * inversePriceScaled) / BigInt(1000000);
          const bufferedSwapA = (swapAmountA * BigInt(110)) / BigInt(100); // 10% buffer
          
          logger.info(`⚠️  Insufficient Token B: need ${requiredB.toString()}, have ${walletB.toString()}`);
          logger.info(`Shortfall: ${shortfallB.toString()}`);
          logger.info(`Swapping ${bufferedSwapA.toString()} of Token A -> B (with 10% buffer)`);
          
          // Execute swap A -> B
          await this.executeSwap(
            pool,
            true, // swapFromA = true means A -> B
            bufferedSwapA,
            this.config.maxSlippagePercent
          );
          
          // Re-read wallet balances after swap
          walletA = await this.suiClient.getWalletBalance(pool.coinTypeA);
          walletB = await this.suiClient.getWalletBalance(pool.coinTypeB);
          
          logger.info(`After swap - Wallet A: ${walletA.toString()}, Wallet B: ${walletB.toString()}`);
        } else {
          logger.info('✅ Wallet balances sufficient, no swap needed');
        }
        logger.info('=========================================================');
      }
      
      // Step 5: Calculate final amounts based on price position
      logger.info('=== Step 5: Calculate Final Amounts ===');
      let finalAmountA: bigint;
      let finalAmountB: bigint;
      
      if (pricePosition === PricePosition.INSIDE) {
        // For INSIDE: use min of wallet and required for both tokens
        finalAmountA = walletA < requiredA ? walletA : requiredA;
        finalAmountB = walletB < requiredB ? walletB : requiredB;
      } else if (pricePosition === PricePosition.BELOW) {
        // For BELOW: only use token A
        finalAmountA = walletA < requiredA ? walletA : requiredA;
        finalAmountB = BigInt(0);
      } else {
        // For ABOVE: only use token B
        finalAmountA = BigInt(0);
        finalAmountB = walletB < requiredB ? walletB : requiredB;
      }
      
      // Apply safety buffers
      const { usableTokenA, usableTokenB } = applySafetyBuffers(finalAmountA, finalAmountB);
      finalAmountA = usableTokenA;
      finalAmountB = usableTokenB;
      
      logger.info(`Final Amount A: ${finalAmountA.toString()}`);
      logger.info(`Final Amount B: ${finalAmountB.toString()}`);
      logger.info('========================================');
      
      // Step 6: Validation BEFORE addLiquidity
      logger.info('=== Step 6: Validation Before addLiquidity ===');
      let validationPassed = false;
      
      if (pricePosition === PricePosition.INSIDE) {
        if (finalAmountA > BigInt(0) && finalAmountB > BigInt(0)) {
          logger.info('✅ Validation PASSED: Both tokens have positive amounts (INSIDE position)');
          validationPassed = true;
        } else {
          logger.error('❌ Validation FAILED: INSIDE position requires both tokens > 0');
          logger.error(`  Final Amount A: ${finalAmountA.toString()}`);
          logger.error(`  Final Amount B: ${finalAmountB.toString()}`);
        }
      } else if (pricePosition === PricePosition.BELOW) {
        if (finalAmountA > BigInt(0)) {
          logger.info('✅ Validation PASSED: Token A has positive amount (BELOW position)');
          validationPassed = true;
        } else {
          logger.error('❌ Validation FAILED: BELOW position requires Token A > 0');
          logger.error(`  Final Amount A: ${finalAmountA.toString()}`);
        }
      } else {
        // ABOVE
        if (finalAmountB > BigInt(0)) {
          logger.info('✅ Validation PASSED: Token B has positive amount (ABOVE position)');
          validationPassed = true;
        } else {
          logger.error('❌ Validation FAILED: ABOVE position requires Token B > 0');
          logger.error(`  Final Amount B: ${finalAmountB.toString()}`);
        }
      }
      
      if (!validationPassed) {
        logger.error('⚠️  ABORTING: Validation failed - cannot add liquidity');
        logger.error('Position will remain open without liquidity.');
        logger.error('Manual intervention may be required.');
        
        // Clear state to return to monitoring
        this.stateManager.clearState();
        
        return;
      }
      logger.info('===============================================');
      
      // Step 7: Log comprehensive summary
      const { totalValue: actualAddedValue } = calculateQuoteValue(
        finalAmountA,
        finalAmountB,
        sqrtPrice
      );
      const valueDifferencePercent = closedPositionValue > 0 
        ? ((actualAddedValue - closedPositionValue) / closedPositionValue) * 100 
        : 0;
      
      logger.info('=== CLMM LIQUIDITY ADDITION SUMMARY ===');
      logger.info(`Price Position: ${pricePosition}`);
      logger.info(`Required Token A: ${requiredA.toString()}`);
      logger.info(`Required Token B: ${requiredB.toString()}`);
      logger.info(`Final Amount A: ${finalAmountA.toString()}`);
      logger.info(`Final Amount B: ${finalAmountB.toString()}`);
      logger.info(`Closed Position Value: ${closedPositionValue.toFixed(6)}`);
      logger.info(`Target Liquidity Value: ${targetLiquidityValue.toFixed(6)}`);
      logger.info(`Actual Added Value: ${actualAddedValue.toFixed(6)}`);
      logger.info(`Value Difference: ${valueDifferencePercent.toFixed(2)}%`);
      logger.info('=======================================');
      
      logger.info('Adding liquidity to position...');
      logger.info(`  Using Token A: ${finalAmountA.toString()}`);
      logger.info(`  Using Token B: ${finalAmountB.toString()}`);
      
      // Add liquidity to the position
      const liquidityResult = await this.addLiquidity(
        newPositionId,
        pool,
        newRange.tickLower,
        newRange.tickUpper,
        finalAmountA,
        finalAmountB,
        this.config.maxSlippagePercent
      );
      
      // Structured log for liquidity addition
      logAddLiquidity({
        positionId: newPositionId,
        amountA: finalAmountA.toString(),
        amountB: finalAmountB.toString(),
        success: true,
        transactionDigest: liquidityResult?.digest,
      });
      
      // Refresh balances to show what's left (dust)
      const dustA = await this.suiClient.getWalletBalance(pool.coinTypeA);
      const dustB = await this.suiClient.getWalletBalance(pool.coinTypeB);
      
      logger.info('=== Final Wallet Balances (After Liquidity) ===');
      logger.info(`Token A (${pool.coinTypeA.substring(0, 20)}...): ${dustA.toString()} (dust remaining)`);
      logger.info(`Token B (${pool.coinTypeB.substring(0, 20)}...): ${dustB.toString()} (dust remaining)`);
      logger.info('=================================================');
      
      // Calculate final portfolio value to verify preservation
      const { totalValue: liquidityTotalValue } = calculateQuoteValue(
        finalAmountA,
        finalAmountB,
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
      logger.info(`Original Closed Position Value: ${closedPositionValue.toFixed(6)}`);
      
      // Check if value is preserved (within 1% tolerance to account for slippage and rounding)
      const valuePreserved = Math.abs(finalTotalValue - closedPositionValue) < 0.01 * closedPositionValue;
      logger.info(`Value Preserved: ${valuePreserved ? 'YES' : 'NO (within 1% tolerance)'}`);
      logger.info('==============================');
      
      addSentryBreadcrumb('Liquidity added to position', 'rebalance', {
        positionId: newPositionId,
        amountA: finalAmountA.toString(),
        amountB: finalAmountB.toString(),
        dustA: dustA.toString(),
        dustB: dustB.toString(),
        finalTotalValue: finalTotalValue.toString(),
        closedPositionValue: closedPositionValue.toString(),
        valuePreserved: valuePreserved,
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
      
      // Save state: LIQUIDITY_ADDED (final state before clearing)
      this.stateManager.saveState({
        state: RebalanceState.LIQUIDITY_ADDED,
        positionId: position.id,
        poolId: pool.id,
        timestamp: new Date().toISOString(),
        data: {
          newPositionId: newPositionId,
          valuePreserved: valuePreserved,
        },
      });
      
      // Clear state - rebalance complete, return to MONITORING
      this.stateManager.clearState();

      
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
  ): Promise<{ digest?: string }> {
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
    const result = await this.suiClient.executeSDKPayload(tx);
    return { digest: result.digest };
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
  ): Promise<{ digest?: string }> {
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
    const result = await this.suiClient.executeSDKPayload(tx);
    
    logger.info('✅ Swap executed successfully');
    return { digest: result.digest };
  }
  
  /**
   * Open a new position using Cetus SDK
   * Creates position NFT without adding liquidity
   * @returns Object with position ID and transaction digest
   */
  private async openPosition(
    pool: Pool,
    tickLower: number,
    tickUpper: number
  ): Promise<{ positionId: string; digest?: string }> {
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
    
    return { positionId, digest: result.digest };
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
   * @param tickLower Lower tick of the position range
   * @param tickUpper Upper tick of the position range
   * @param amountA Amount of token A to add
   * @param amountB Amount of token B to add
   * @param slippagePercent Slippage tolerance percentage
   * @returns Object with transaction digest
   */
  private async addLiquidity(
    positionId: string,
    pool: Pool,
    tickLower: number,
    tickUpper: number,
    amountA: bigint,
    amountB: bigint,
    slippagePercent: number
  ): Promise<{ digest?: string }> {
    const sdk = this.cetusService.getSDK();
    
    logger.info('Adding liquidity to position...');
    logger.info(`  Position ID: ${positionId}`);
    logger.info(`  Amount A: ${amountA.toString()}`);
    logger.info(`  Amount B: ${amountB.toString()}`);
    logger.info(`  Slippage: ${slippagePercent}%`);
    
    // Build the add liquidity transaction using Cetus SDK
    // The SDK requires delta_liquidity and max amounts (not fixed amounts)
    // For now, we'll use the amounts as max values and let SDK calculate liquidity
    const tx = await sdk.Position.createAddLiquidityPayload({
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      pool_id: pool.id,
      pos_id: positionId,
      delta_liquidity: '0', // SDK will calculate based on max amounts
      max_amount_a: amountA.toString(),
      max_amount_b: amountB.toString(),
      tick_lower: tickLower,
      tick_upper: tickUpper,
      collect_fee: false, // Don't collect fees when adding to newly opened position
      rewarder_coin_types: [],  // No rewarders for now
    });
    
    // Execute the transaction and wait for confirmation
    const result = await this.suiClient.executeSDKPayload(tx);
    
    logger.info('✅ Liquidity added successfully');
    return { digest: result.digest };
  }
}
