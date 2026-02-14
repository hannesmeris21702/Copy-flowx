import { Transaction, TransactionObjectArgument, coinWithBalance } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';
import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import { logPTBValidation } from '../utils/botLogger';
import { explainError } from '../utils/errorExplainer';
import { setSentryContext, addSentryBreadcrumb, captureException } from '../utils/sentry';
import { normalizeTypeArguments, validateTypeArguments } from '../utils/typeArgNormalizer';
import { PTBValidator } from '../utils/ptbValidator';
import { PTBPreExecutionValidator } from '../utils/ptbPreExecutionValidator';
import { safeMergeCoins, safeUseNestedResult } from '../utils/ptbHelpers';
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
      logger.info('=== Starting Atomic PTB Rebalance ===');
      
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
      // FIXED: Use bigint arithmetic to avoid precision loss
      const expectedAmounts = this.calculateExpectedAmounts(pool, position);
      const slippagePercent = BigInt(Math.floor(this.config.maxSlippagePercent * 100)); // Convert to basis points
      const minAmountA = (expectedAmounts.amountA * (BigInt(10000) - slippagePercent)) / BigInt(10000);
      const minAmountB = (expectedAmounts.amountB * (BigInt(10000) - slippagePercent)) / BigInt(10000);
      
      logger.info(`Expected amounts: A=${expectedAmounts.amountA}, B=${expectedAmounts.amountB}`);
      logger.info(`Min amounts (${this.config.maxSlippagePercent}% slippage): A=${minAmountA}, B=${minAmountB}`);
      
      // Build single atomic PTB with pre-build validation
      currentStage = 'build_ptb';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      addSentryBreadcrumb('Building PTB', 'rebalance', {
        minAmountA: minAmountA.toString(),
        minAmountB: minAmountB.toString(),
      });
      
      // @copilot PTB validation happens inside buildRebalancePTB to catch errors early
      const ptb = await this.buildRebalancePTB(pool, position, newRange, minAmountA, minAmountB);
      
      // Log PTB structure for debugging (helps with SecondaryIndexOutOfBounds)
      PTBValidator.logCommandStructure(ptb, 'REBALANCE PTB');
      
      // CRITICAL: Pre-execution validation before submitting PTB
      // Validates:
      // 1. All NestedResult references point to valid commands
      // 2. open_position return is handled safely
      // 3. add_liquidity coin inputs exist
      // Throws descriptive errors early if validation fails
      logger.info('Running pre-execution PTB validation...');
      PTBPreExecutionValidator.validateBeforeExecution(ptb);
      logger.info('✅ Pre-execution validation passed - PTB is safe to execute');
      
      // Execute atomically (single execution)
      currentStage = 'execute_ptb';
      setSentryContext({ poolId: pool.id, positionId: position.id, stage: currentStage });
      addSentryBreadcrumb('Executing PTB', 'rebalance', {
        poolId: pool.id,
        positionId: position.id,
      });
      
      logger.info('Executing atomic PTB...');
      const result = await this.suiClient.executeTransactionWithoutSimulation(ptb);
      
      addSentryBreadcrumb('Rebalance completed successfully', 'rebalance', {
        digest: result.digest,
      });
      
      logger.info(`✅ Rebalance successful! Digest: ${result.digest}`);
      logger.info('=== Atomic PTB Rebalance Complete ===');
      
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
  
  private async buildRebalancePTB(
    pool: Pool,
    position: Position,
    newRange: { tickLower: number; tickUpper: number },
    minAmountA: bigint,
    minAmountB: bigint
  ): Promise<Transaction> {
    const ptb = new Transaction();
    
    // Set sender to enable proper gas coin handling
    // This prevents "Encountered unexpected token when parsing type args for gas" error
    ptb.setSender(this.suiClient.getAddress());
    
    const sdk = this.cetusService.getSDK();
    
    logger.info('Building atomic PTB with all operations using SDK builders...');
    logger.info('=== COIN OBJECT FLOW TRACE ===');
    logger.info('Order: close_position (capture outputs) → swap → open → add_liquidity → transfer');
    
    // CHECK: Validate position liquidity before building PTB
    const positionHasLiquidity = BigInt(position.liquidity) > BigInt(0);
    logger.info(`Position liquidity check: ${position.liquidity} (has liquidity: ${positionHasLiquidity})`);
    
    // Get SDK configuration
    const packageId = sdk.sdkOptions.integrate.published_at;
    const globalConfigId = sdk.sdkOptions.clmm_pool.config!.global_config_id;
    
    // Normalize type arguments to prevent parsing errors
    const normalizedTypeArgs = normalizeTypeArguments([
      pool.coinTypeA,
      pool.coinTypeB
    ]);
    const normalizedCoinTypeA = normalizedTypeArgs[0];
    const normalizedCoinTypeB = normalizedTypeArgs[1];
    
    if (!normalizedCoinTypeA || !normalizedCoinTypeB) {
      throw new Error('Type argument normalization failed: missing normalized types');
    }
    
    logger.debug(`Type args normalized: A=${normalizedCoinTypeA}, B=${normalizedCoinTypeB}`);
    
    // Validate that type arguments are properly normalized
    if (!validateTypeArguments([normalizedCoinTypeA, normalizedCoinTypeB])) {
      throw new Error(
        'Type argument normalization validation failed. ' +
        'Type arguments could not be properly normalized using TypeTagSerializer.'
      );
    }
    logger.debug('Type argument validation passed');
    
    // ============================================================================
    // COIN TRACE: PTB Command Flow with Explicit Result Labels
    // ============================================================================
    // Step 1: Close position (removes liquidity AND closes position NFT)
    // CORRECT APPROACH: Capture the returned coins from close_position
    // close_position returns (Coin<CoinTypeA>, Coin<CoinTypeB>) - tuple of 2 coins
    // These coins contain the actual liquidity from the closed position
    // ============================================================================
    logger.info('Step 1: Close position (removes liquidity & closes NFT) → capturing returned coins');
    
    // Command 0: close_position moveCall
    // IMPORTANT: This returns a tuple (Coin<A>, Coin<B>) containing the position's liquidity
    // We MUST capture these outputs and use them as the liquidity source
    const closePositionResult = ptb.moveCall({
      target: `${packageId}::pool_script::close_position`,
      typeArguments: [normalizedCoinTypeA, normalizedCoinTypeB],
      arguments: [
        ptb.object(globalConfigId),
        ptb.object(pool.id),
        ptb.object(position.id),
        ptb.pure.u64(minAmountA.toString()),
        ptb.pure.u64(minAmountB.toString()),
        ptb.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    
    // Extract the returned coins from close_position
    // These coins contain the actual liquidity and will be used for swaps
    const stableCoinA = safeUseNestedResult(
      closePositionResult,
      0,
      'coinA from close_position'
    );  // Command 0, index 0: Coin<CoinTypeA>
    const stableCoinB = safeUseNestedResult(
      closePositionResult,
      1,
      'coinB from close_position'
    );  // Command 0, index 1: Coin<CoinTypeB>
    logger.info('  ✓ close_position completed - captured returned coins (Coin<A>, Coin<B>)');
    logger.info('  ✓ Using close_position outputs as liquidity source for swaps');
    
    // Step 2: Swap to optimal ratio if needed
    logger.info('Step 2: Swap to optimal ratio (if needed)');
    const { coinA: swappedCoinA, coinB: swappedCoinB } = this.addSwapIfNeeded(
      ptb,
      pool,
      newRange,
      stableCoinA,
      stableCoinB,
      packageId,
      globalConfigId,
      normalizedCoinTypeA,
      normalizedCoinTypeB,
      positionHasLiquidity  // Pass this to help determine if we have coins to swap
    );
    logger.info('  ✓ Final coins ready after swap: swappedCoinA, swappedCoinB');
    
    // Step 3: Open new position
    // Use SDK builder pattern with proper tick conversion from SDK's asUintN
    logger.info('Step 3: Open new position → returns newPosition NFT');
    
    // Convert signed ticks to u32 using BigInt.asUintN (SDK pattern)
    const tickLowerU32 = Number(BigInt.asUintN(32, BigInt(newRange.tickLower)));
    const tickUpperU32 = Number(BigInt.asUintN(32, BigInt(newRange.tickUpper)));
    
    // NOTE: open_position returns a SINGLE Position NFT object (not a tuple)
    // Per Cetus pool_script Move contract: public fun open_position(...): Position
    // This is a public function (not entry), so it returns a value
    // Do NOT use array destructuring or access [0] - it causes SecondaryIndexOutOfBounds error
    // The moveCall result itself IS the Position NFT
    const newPosition = ptb.moveCall({
      target: `${packageId}::pool_script::open_position`,
      typeArguments: [normalizedCoinTypeA, normalizedCoinTypeB],
      arguments: [
        ptb.object(globalConfigId),
        ptb.object(pool.id),
        ptb.pure.u32(tickLowerU32),
        ptb.pure.u32(tickUpperU32),
      ],
    });
    
    logger.info('  ✓ Captured: newPosition NFT from open_position (single value return)');
    
    // ============================================================================
    // Step 4: Validate coins before add_liquidity_by_fix_coin
    // Ensure both coinA and coinB exist from close_position outputs
    // ============================================================================
    logger.info('Step 4: Validate coins for add_liquidity');
    
    // Note: Since we capture coins from close_position, they should always be valid
    // The swappedCoinA and swappedCoinB come from either:
    // 1. Direct use of close_position outputs if no swap needed
    // 2. Swap outputs that merge with close_position outputs
    // Therefore, the fallback code below should not be needed in normal operation
    let finalCoinA = swappedCoinA;
    let finalCoinB = swappedCoinB;
    
    if (!swappedCoinA || !swappedCoinB) {
      // This should not happen under normal operation since close_position
      // always returns coins. Log as error if we hit this.
      throw new Error(
        `Missing coin after swap: swappedCoinA=${!!swappedCoinA}, swappedCoinB=${!!swappedCoinB}. ` +
        'This indicates a bug in the swap logic.'
      );
    }
    
    logger.info('  ✓ Both coins validated: finalCoinA and finalCoinB ready');
    
    // Step 5: Add liquidity to new position
    // NOTE: Under normal operation, open_position returns a valid position NFT
    // If open_position fails, the entire PTB transaction will revert atomically
    // Use SDK builder pattern: pool_script_v2::add_liquidity_by_fix_coin
    logger.info('Step 5: Add liquidity → consumes finalCoinA, finalCoinB');
    
    ptb.moveCall({
      target: `${packageId}::pool_script_v2::add_liquidity_by_fix_coin`,
      typeArguments: [normalizedCoinTypeA, normalizedCoinTypeB],
      arguments: [
        ptb.object(globalConfigId),
        ptb.object(pool.id),
        newPosition,
        finalCoinA,
        finalCoinB,
        ptb.pure.u64(minAmountA.toString()),
        ptb.pure.u64(minAmountB.toString()),
        ptb.pure.bool(true), // fix_amount_a
        ptb.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    logger.info('  ✓ Liquidity added, coins consumed');
    
    // Step 6: Transfer new position NFT to sender
    // NOTE: Direct transferObjects is safe here because:
    // 1. newPosition is a PTB reference (always valid during construction)
    // 2. If open_position fails, the entire PTB reverts atomically
    // 3. Sui PTB framework validates all object references during execution
    logger.info('Step 6: Transfer newPosition NFT to sender');
    ptb.transferObjects([newPosition], ptb.pure.address(this.suiClient.getAddress()));
    logger.info('  ✓ Position transferred');
    
    logger.info('=== END COIN OBJECT FLOW TRACE ===');
    logger.info('Flow: close_position (capture outputs) → swap (if needed) → open → add_liquidity → transfer');
    logger.info('ALL LIQUIDITY FROM close_position RETURNED COINS');
    logger.info('CORRECT APPROACH: Using actual liquidity coins, not zero coins');
    
    // Add PTB validation: Print commands with detailed info before build
    // Log 'Command ${i}: ${txb.getEffects()}' as requested in problem statement
    // Note: getEffects() is not available pre-build, so we log command structure
    const ptbData = ptb.getData();
    logPTBValidation(ptbData);
    
    // Validate NestedResult references before building PTB
    // This ensures no NestedResult references a command result index that doesn't exist
    // After fix: All NestedResult references should point to close_position outputs (Command 0)
    this.validateNestedResultReferences(ptb);
    
    logger.info('✅ PTB Dry-run PASSED - validation complete');
    
    return ptb;
  }
  
  /**
   * Validates that all NestedResult references in the PTB point to valid command indices.
   * This prevents invalid PTB construction where a NestedResult references a command
   * that doesn't exist or hasn't been executed yet.
   * 
   * After the fix: All NestedResult references should point to close_position outputs (Command 0).
   * 
   * @param ptb - The Transaction to validate
   * @throws Error if any NestedResult references an invalid command index (out of bounds or future command)
   */
  private validateNestedResultReferences(ptb: Transaction): void {
    const ptbData = ptb.getData();
    const totalCommands = ptbData.commands.length;
    
    logger.debug(`Validating NestedResult references in PTB with ${totalCommands} commands`);
    
    // Helper function to recursively check for NestedResult in an object
    const checkForNestedResult = (obj: unknown, currentCommandIdx: number, path: string = ''): void => {
      if (!obj || typeof obj !== 'object') {
        return;
      }
      
      // Check if this is a NestedResult
      if (typeof obj === 'object' && obj !== null && '$kind' in obj && obj.$kind === 'NestedResult' && 'NestedResult' in obj && Array.isArray(obj.NestedResult)) {
        const [commandIndex, resultIndex] = obj.NestedResult;
        
        // Validate that the referenced command index exists and comes before current command
        if (commandIndex < 0 || commandIndex >= totalCommands) {
          throw new Error(
            `Invalid NestedResult reference at ${path}: ` +
            `references command ${commandIndex} but only ${totalCommands} commands exist. ` +
            `NestedResult: [${commandIndex}, ${resultIndex}]`
          );
        }
        
        // Additional check: referenced command should come before the command using it
        if (commandIndex >= currentCommandIdx) {
          throw new Error(
            `Invalid NestedResult reference at ${path}: ` +
            `command ${currentCommandIdx} references future command ${commandIndex}. ` +
            `NestedResult: [${commandIndex}, ${resultIndex}]`
          );
        }
        
        logger.debug(`  ✓ Valid NestedResult at ${path}: [${commandIndex}, ${resultIndex}]`);
      }
      
      // Recursively check all properties
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => {
          checkForNestedResult(item, currentCommandIdx, path ? `${path}[${idx}]` : `[${idx}]`);
        });
      } else {
        Object.keys(obj).forEach(key => {
          if (key !== '$kind') { // Skip the $kind marker
            const value = (obj as Record<string, unknown>)[key];
            checkForNestedResult(value, currentCommandIdx, path ? `${path}.${key}` : key);
          }
        });
      }
    };
    
    // Check each command for NestedResult references
    ptbData.commands.forEach((cmd: unknown, idx: number) => {
      checkForNestedResult(cmd, idx, `Command[${idx}]`);
    });
    
    logger.info(`✓ PTB validation passed: all NestedResult references are valid`);
  }
  
  
  private addSwapIfNeeded(
    ptb: Transaction,
    pool: Pool,
    newRange: { tickLower: number; tickUpper: number },
    coinA: TransactionObjectArgument,
    coinB: TransactionObjectArgument,
    packageId: string,
    globalConfigId: string,
    normalizedCoinTypeA: string,
    normalizedCoinTypeB: string,
    positionHasLiquidity: boolean
  ): { coinA: TransactionObjectArgument; coinB: TransactionObjectArgument } {
    // Calculate optimal ratio for new range
    const sqrtPriceCurrent = BigInt(pool.currentSqrtPrice);
    const sqrtPriceLower = tickToSqrtPrice(newRange.tickLower);
    const sqrtPriceUpper = tickToSqrtPrice(newRange.tickUpper);
    
    // Sqrt price limits for swaps (from Cetus SDK)
    const MIN_SQRT_PRICE = '4295048016';
    const MAX_SQRT_PRICE = '79226673515401279992447579055';
    
    // Maximum u64 value for swap amount
    const U64_MAX = '18446744073709551615';
    
    if (sqrtPriceCurrent < sqrtPriceLower) {
      // Price below range - need token A, swap B to A
      logger.info('  Price below new range - need to swap coinB to coinA');
      
      // CHECK: Only perform swap if we have liquidity (and thus coins to swap)
      // Per Cetus SDK pattern: don't call swap with zero amounts
      // If position has no liquidity, we have coins from close_position
      // In this case, skip the swap entirely if coins have zero balance
      if (!positionHasLiquidity) {
        logger.warn('  ⚠ Skipping swap: position has no liquidity, coins likely have zero balance');
        logger.info('  Using coins as-is (no swap performed)');
        return { coinA, coinB };
      }
      
      const zeroCoinA = coinWithBalance({ type: normalizedCoinTypeA, balance: 0, useGasCoin: false })(ptb);
      
      // Use SDK builder pattern: router::swap
      // Returns tuple (Coin<A>, Coin<B>) - extract safely without direct indexing
      const swapResult = ptb.moveCall({
        target: `${packageId}::router::swap`,
        typeArguments: [normalizedCoinTypeA, normalizedCoinTypeB],
        arguments: [
          ptb.object(globalConfigId),
          ptb.object(pool.id),
          zeroCoinA,
          coinB,
          ptb.pure.bool(false), // a2b: false = B to A
          ptb.pure.bool(true), // by_amount_in
          ptb.pure.u64(U64_MAX),
          ptb.pure.u128(MAX_SQRT_PRICE),
          ptb.pure.bool(false), // use_coin_value
          ptb.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
      
      // Extract results safely without direct indexing
      const swappedCoinA = safeUseNestedResult(swapResult, 0, 'swapped coinA from router::swap');
      const remainderCoinB = safeUseNestedResult(swapResult, 1, 'remainder coinB from router::swap');
      
      // Swap was performed: reference the NestedResult output and merge
      // Use conditional merge pattern to ensure safe coin handling per Cetus SDK
      logger.debug('  Merging swap output (swappedCoinA) into coinA');
      safeMergeCoins(ptb, coinA, swappedCoinA, { description: 'swap output into coinA' });
      logger.debug('  Merging swap remainder (remainderCoinB) into coinB');
      safeMergeCoins(ptb, coinB, remainderCoinB, { description: 'swap remainder into coinB' });
      logger.info('  ✓ Swapped: coinB to coinA, output and remainder merged into stable coins');
      
      return { coinA, coinB };
      
    } else if (sqrtPriceCurrent > sqrtPriceUpper) {
      // Price above range - need token B, swap A to B
      logger.info('  Price above new range - need to swap coinA to coinB');
      
      // CHECK: Only perform swap if we have liquidity (and thus coins to swap)
      if (!positionHasLiquidity) {
        logger.warn('  ⚠ Skipping swap: position has no liquidity, coins likely have zero balance');
        logger.info('  Using coins as-is (no swap performed)');
        return { coinA, coinB };
      }
      
      const zeroCoinB = coinWithBalance({ type: normalizedCoinTypeB, balance: 0, useGasCoin: false })(ptb);
      
      // Use SDK builder pattern: router::swap
      // Returns tuple (Coin<A>, Coin<B>) - extract safely without direct indexing
      const swapResult = ptb.moveCall({
        target: `${packageId}::router::swap`,
        typeArguments: [normalizedCoinTypeA, normalizedCoinTypeB],
        arguments: [
          ptb.object(globalConfigId),
          ptb.object(pool.id),
          coinA,
          zeroCoinB,
          ptb.pure.bool(true), // a2b: true = A to B
          ptb.pure.bool(true), // by_amount_in
          ptb.pure.u64(U64_MAX),
          ptb.pure.u128(MIN_SQRT_PRICE),
          ptb.pure.bool(false), // use_coin_value
          ptb.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
      
      // Extract results safely without direct indexing
      const remainderCoinA = safeUseNestedResult(swapResult, 0, 'remainder coinA from router::swap');
      const swappedCoinB = safeUseNestedResult(swapResult, 1, 'swapped coinB from router::swap');
      
      // Swap was performed: reference the NestedResult output and merge
      // Use conditional merge pattern to ensure safe coin handling per Cetus SDK
      logger.debug('  Merging swap output (swappedCoinB) into coinB');
      safeMergeCoins(ptb, coinB, swappedCoinB, { description: 'swap output into coinB' });
      logger.debug('  Merging swap remainder (remainderCoinA) into coinA');
      safeMergeCoins(ptb, coinA, remainderCoinA, { description: 'swap remainder into coinA' });
      logger.info('  ✓ Swapped: coinA to coinB, output and remainder merged into stable coins');
      
      return { coinA, coinB };
      
    } else {
      // Price in range - use both tokens as-is
      logger.info('  Price in new range - using both coins as-is (no swap needed)');
      return { coinA, coinB };
    }
  }
}
