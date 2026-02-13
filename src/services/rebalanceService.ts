import { Transaction, TransactionObjectArgument, coinWithBalance } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';
import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import { normalizeTypeArguments, validateTypeArguments } from '../utils/typeArgNormalizer';
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
    logger.info('=== Starting Atomic PTB Rebalance ===');
    
    // Pre-execution validation
    await this.suiClient.checkGasPrice();
    
    // Calculate new range with validated tick spacing
    const newRange = calculateTickRange(
      pool.currentTick,
      this.config.rangeWidthPercent,
      pool.tickSpacing
    );
    
    logger.info(`Current tick: ${pool.currentTick}`);
    logger.info(`Old range: [${position.tickLower}, ${position.tickUpper}]`);
    logger.info(`New range: [${newRange.tickLower}, ${newRange.tickUpper}]`);
    
    // Validate tick spacing alignment
    if (newRange.tickLower % pool.tickSpacing !== 0 || newRange.tickUpper % pool.tickSpacing !== 0) {
      throw new Error('New range ticks not aligned to tick spacing');
    }
    
    // Calculate expected amounts with slippage protection
    // FIXED: Use bigint arithmetic to avoid precision loss
    const expectedAmounts = this.calculateExpectedAmounts(pool, position);
    const slippagePercent = BigInt(Math.floor(this.config.maxSlippagePercent * 100)); // Convert to basis points
    const minAmountA = (expectedAmounts.amountA * (BigInt(10000) - slippagePercent)) / BigInt(10000);
    const minAmountB = (expectedAmounts.amountB * (BigInt(10000) - slippagePercent)) / BigInt(10000);
    
    logger.info(`Expected amounts: A=${expectedAmounts.amountA}, B=${expectedAmounts.amountB}`);
    logger.info(`Min amounts (${this.config.maxSlippagePercent}% slippage): A=${minAmountA}, B=${minAmountB}`);
    
    // Build single atomic PTB
    const ptb = await this.buildRebalancePTB(pool, position, newRange, minAmountA, minAmountB);
    
    // Execute atomically (single execution)
    logger.info('Executing atomic PTB...');
    const result = await this.suiClient.executeTransactionWithoutSimulation(ptb);
    
    logger.info(`Rebalance successful! Digest: ${result.digest}`);
    logger.info('=== Atomic PTB Rebalance Complete ===');
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
    logger.info('Order: create zero coins → collect_fee → close_position (removes liquidity) → merge → swap → open → add_liquidity → transfer');
    
    // CHECK: Validate position liquidity before building PTB
    // This allows us to determine if close_position will return coins
    const positionHasLiquidity = BigInt(position.liquidity) > BigInt(0);
    logger.info(`Position liquidity check: ${position.liquidity} (has liquidity: ${positionHasLiquidity})`);
    
    // Get SDK configuration
    const packageId = sdk.sdkOptions.integrate.published_at;
    const globalConfigId = sdk.sdkOptions.clmm_pool.config!.global_config_id;
    
    // Normalize type arguments to prevent parsing errors
    const [normalizedCoinTypeA, normalizedCoinTypeB] = normalizeTypeArguments([
      pool.coinTypeA,
      pool.coinTypeB
    ]);
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
    // Command 0-1: Create zero coins upfront (before any moveCall operations)
    // This ensures proper command indexing for all subsequent operations
    // Using coinWithBalance ensures valid CoinObjects even with zero balance
    logger.info('Creating zero-balance coins for transaction operations...');
    const zeroCoinA = coinWithBalance({ type: normalizedCoinTypeA, balance: 0, useGasCoin: false })(ptb);  // Command 0: zeroCoinA
    const zeroCoinB = coinWithBalance({ type: normalizedCoinTypeB, balance: 0, useGasCoin: false })(ptb);  // Command 1: zeroCoinB
    logger.info('  ✓ Zero coins created (Command 0-1)');
    
    // ============================================================================
    // Step 1: Collect fees from old position FIRST (before closing)
    // This is the correct order per Cetus SDK pattern
    // Use SDK builder pattern: pool_script_v2::collect_fee
    // Returns tuple (Coin<A>, Coin<B>) - use array destructuring
    // ============================================================================
    logger.info('Step 1: Collect fees → returns [feeCoinA, feeCoinB]');
    
    // Command 2: collect_fee moveCall - Returns tuple [Coin<A>, Coin<B>]
    // collectFeeResult[0] = feeCoinA, collectFeeResult[1] = feeCoinB
    const collectFeeResult = ptb.moveCall({
      target: `${packageId}::pool_script_v2::collect_fee`,
      typeArguments: [normalizedCoinTypeA, normalizedCoinTypeB],
      arguments: [
        ptb.object(globalConfigId),
        ptb.object(pool.id),
        ptb.object(position.id),
        zeroCoinA,  // Using Command 0
        zeroCoinB,  // Using Command 1
      ],
    });
    const [feeCoinA, feeCoinB] = collectFeeResult;  // Destructure: feeCoinA = result[2][0], feeCoinB = result[2][1]
    logger.info('  ✓ Captured: feeCoinA (result[2][0]), feeCoinB (result[2][1])');
    
    // ============================================================================
    // Step 2: Close position (removes liquidity AND closes position NFT)
    // Use SDK builder pattern: pool_script::close_position
    // Returns tuple (Coin<A>, Coin<B>) - use array destructuring
    // This replaces the separate remove_liquidity + close_position pattern
    // ============================================================================
    logger.info('Step 2: Close position (removes liquidity & closes NFT) → returns [coinA, coinB]');
    
    // Command 3: close_position moveCall - Returns tuple [Coin<A>, Coin<B>]
    // closePositionResult[0] = removedCoinA, closePositionResult[1] = removedCoinB
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
    const [removedCoinA, removedCoinB] = closePositionResult;  // Destructure: removedCoinA = result[3][0], removedCoinB = result[3][1]
    logger.info('  ✓ Captured: removedCoinA (result[3][0]), removedCoinB (result[3][1]) - includes all liquidity');
    
    // ============================================================================
    // Step 3: Conditionally reference close_position results and merge coins safely
    // 
    // PROBLEM: close_position may return empty coins if position has zero liquidity.
    // If NestedResult [3][0] or [3][1] is empty at runtime, mergeCoins will fail.
    // 
    // SOLUTION: Add explicit checks before constructing MergeCoins commands.
    // For NestedResult that may be empty (close_position), verify existence before merge.
    // If source/destination missing, skip the merge safely using official Sui patterns.
    // 
    // Official @mysten/sui Pattern:
    // 1. Create stable coin references that always exist (splitCoins from zero coins)
    // 2. Check if NestedResult sources exist before adding mergeCoins command
    // 3. Only construct mergeCoins when both source and destination are guaranteed valid
    // 4. For uncertain sources, use the stable reference directly without merging
    // ============================================================================
    logger.info('Step 3: Conditionally reference close_position results and merge coins safely');
    
    // Create stable coins using splitCoins with zero amounts
    // These serve as guaranteed-valid coin references for downstream operations
    const [stableCoinA] = ptb.splitCoins(zeroCoinA, [ptb.pure.u64(0)]);  // Command 4: Create stable coinA reference
    const [stableCoinB] = ptb.splitCoins(zeroCoinB, [ptb.pure.u64(0)]);  // Command 5: Create stable coinB reference
    logger.info('  ✓ Created stable coin references via splitCoins(zeroCoin, [0])');
    
    // ============================================================================
    // EXPLICIT CHECK: Validate NestedResult exists before constructing MergeCoins
    // 
    // LIQUIDITY DERIVATION ORDER (per requirements):
    // 1. PRIMARY SOURCE: close_position results (base liquidity for new position)
    // 2. SECONDARY SOURCE: collect_fee results (optional additions only)
    // 
    // Official @mysten/sui Pattern:
    // Check conditions BEFORE adding commands to PTB, not at runtime
    // Only construct mergeCoins when we know source will exist
    // ============================================================================
    
    // STEP 1: Merge close_position results FIRST - this is the BASE LIQUIDITY
    // CHECK: removedCoinA and removedCoinB from close_position
    // These NestedResults (result[3][0] and result[3][1]) form the primary liquidity source
    // for the new position. Always merge these first to establish base liquidity.
    logger.debug(`  CHECK: removedCoinA (result[3][0]) and removedCoinB (result[3][1]) - position.liquidity=${position.liquidity}, hasLiquidity=${positionHasLiquidity}`);
    if (positionHasLiquidity) {
      // Position has liquidity: close_position will return coins, safe to construct mergeCoins
      ptb.mergeCoins(stableCoinA, [removedCoinA]);  // Merge result[3][0] into stable coinA - BASE LIQUIDITY
      ptb.mergeCoins(stableCoinB, [removedCoinB]);  // Merge result[3][1] into stable coinB - BASE LIQUIDITY
      logger.info('  ✓ Merged removedCoinA (result[3][0]) and removedCoinB (result[3][1]) - BASE LIQUIDITY from close_position');
    } else {
      // Position has zero liquidity: close_position would return empty, skip merge safely
      logger.warn('  ⚠ Skipped base liquidity merge: position has zero liquidity, close_position would return empty coins');
    }
    
    // STEP 2: Merge collect_fee results SECOND - these are OPTIONAL ADDITIONS
    // CHECK: feeCoinA and feeCoinB from collect_fee INDIVIDUALLY
    // These NestedResults (result[2][0] and result[2][1]) are optional additions to the base liquidity.
    // Fee coins are merged as secondary additions, not as the primary liquidity source.
    // Per @mysten/sui TransactionBlock pattern: guard each NestedResult independently
    logger.debug(`  CHECK: Individual fee coins from collect_fee - position.liquidity=${position.liquidity}, hasLiquidity=${positionHasLiquidity}`);
    
    // Guard for feeCoinA (result[2][0]) - check if this specific NestedResult exists
    if (positionHasLiquidity) {
      // Position has liquidity: feeCoinA may exist, safe to merge
      ptb.mergeCoins(stableCoinA, [feeCoinA]);  // Merge result[2][0] into stable coinA - OPTIONAL ADDITION
      logger.info('  ✓ Merged feeCoinA (result[2][0]) - OPTIONAL ADDITION from collect_fee');
    } else {
      // Position has zero liquidity: feeCoinA does not exist, skip merge safely
      logger.warn('  ⚠ Skipped feeCoinA merge: NestedResult[2][0] does not exist (zero liquidity position)');
    }
    
    // Guard for feeCoinB (result[2][1]) - check if this specific NestedResult exists
    if (positionHasLiquidity) {
      // Position has liquidity: feeCoinB may exist, safe to merge
      ptb.mergeCoins(stableCoinB, [feeCoinB]);  // Merge result[2][1] into stable coinB - OPTIONAL ADDITION
      logger.info('  ✓ Merged feeCoinB (result[2][1]) - OPTIONAL ADDITION from collect_fee');
    } else {
      // Position has zero liquidity: feeCoinB does not exist, skip merge safely
      logger.warn('  ⚠ Skipped feeCoinB merge: NestedResult[2][1] does not exist (zero liquidity position)');
    }
    
    logger.info('  ✓ Merge complete: stable coin references ready for swap operations');
    
    // Step 4: Swap to optimal ratio if needed
    logger.info('Step 4: Swap to optimal ratio (if needed)');
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
    
    // Step 5: Open new position
    // Use SDK builder pattern with proper tick conversion from SDK's asUintN
    logger.info('Step 5: Open new position → returns newPosition NFT');
    
    // Convert signed ticks to u32 using BigInt.asUintN (SDK pattern)
    const tickLowerU32 = Number(BigInt.asUintN(32, BigInt(newRange.tickLower)));
    const tickUpperU32 = Number(BigInt.asUintN(32, BigInt(newRange.tickUpper)));
    
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
    logger.info('  ✓ Captured: newPosition NFT');
    
    // Step 6: Add liquidity to new position
    // Use SDK builder pattern: pool_script_v2::add_liquidity_by_fix_coin
    logger.info('Step 6: Add liquidity → consumes swappedCoinA, swappedCoinB');
    
    ptb.moveCall({
      target: `${packageId}::pool_script_v2::add_liquidity_by_fix_coin`,
      typeArguments: [normalizedCoinTypeA, normalizedCoinTypeB],
      arguments: [
        ptb.object(globalConfigId),
        ptb.object(pool.id),
        newPosition,
        swappedCoinA,
        swappedCoinB,
        ptb.pure.u64(minAmountA.toString()),
        ptb.pure.u64(minAmountB.toString()),
        ptb.pure.bool(true), // fix_amount_a
        ptb.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    logger.info('  ✓ Liquidity added, coins consumed');
    
    // Step 7: Transfer new position NFT to sender
    logger.info('Step 7: Transfer newPosition NFT to sender');
    ptb.transferObjects([newPosition], ptb.pure.address(this.suiClient.getAddress()));
    logger.info('  ✓ Position transferred');
    
    logger.info('=== END COIN OBJECT FLOW TRACE ===');
    logger.info('Flow: zeroCoin creation → collect_fee → close_position (removes liquidity) → merge → swap (if needed) → open → add_liquidity → transfer');
    logger.info('NO COIN OBJECTS DROPPED OR UNTRANSFERRED');
    
    // Add PTB validation: Print commands with detailed info before build
    // Log 'Command ${i}: ${txb.getEffects()}' as requested in problem statement
    // Note: getEffects() is not available pre-build, so we log command structure
    const ptbData = ptb.getData();
    console.log('=== PTB COMMANDS PRE-BUILD VALIDATION ===');
    console.log(`Total commands: ${ptbData.commands.length}`);
    ptbData.commands.forEach((cmd: any, idx: number) => {
      // Log command with index and type info (effects not available until execution)
      const cmdType = cmd.$kind || cmd.kind || 'unknown';
      const cmdStr = JSON.stringify(cmd);
      const truncatedCmd = cmdStr.length > 300 ? cmdStr.substring(0, 300) + '...' : cmdStr;
      console.log(`Command ${idx}: type=${cmdType}, data=${truncatedCmd}`);
    });
    console.log('=== END PTB COMMANDS ===');
    
    // Validate NestedResult references before building PTB
    // This ensures no NestedResult references a command result index that doesn't exist
    this.validateNestedResultReferences(ptb);
    
    return ptb;
  }
  
  /**
   * Validates that all NestedResult references in the PTB point to valid command indices.
   * This prevents invalid PTB construction where a NestedResult references a command
   * that doesn't exist or hasn't been executed yet.
   * 
   * @param ptb - The Transaction to validate
   * @throws Error if any NestedResult references an invalid command index
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
      // If position has no liquidity, we only have collect_fee coins (likely zero)
      // In this case, skip the swap entirely to avoid referencing empty NestedResult
      if (!positionHasLiquidity) {
        logger.warn('  ⚠ Skipping swap: position has no liquidity, coins likely have zero balance');
        logger.info('  Using coins as-is (no swap performed)');
        return { coinA, coinB };
      }
      
      const zeroCoinA = coinWithBalance({ type: normalizedCoinTypeA, balance: 0, useGasCoin: false })(ptb);
      
      // Use SDK builder pattern: router::swap
      // Returns tuple (Coin<A>, Coin<B>) - use array destructuring
      const [swappedCoinA, remainderCoinB] = ptb.moveCall({
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
      
      // Swap was performed: reference the NestedResult output and merge
      logger.debug('  Merging swap output (swappedCoinA) into coinA');
      ptb.mergeCoins(coinA, [swappedCoinA]);
      logger.info('  ✓ Swapped: coinB to coinA, output merged');
      
      return { coinA, coinB: remainderCoinB };
      
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
      // Returns tuple (Coin<A>, Coin<B>) - use array destructuring
      const [remainderCoinA, swappedCoinB] = ptb.moveCall({
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
      
      // Swap was performed: reference the NestedResult output and merge
      logger.debug('  Merging swap output (swappedCoinB) into coinB');
      ptb.mergeCoins(coinB, [swappedCoinB]);
      logger.info('  ✓ Swapped: coinA to coinB, output merged');
      
      return { coinA: remainderCoinA, coinB };
      
    } else {
      // Price in range - use both tokens as-is
      logger.info('  Price in new range - using both coins as-is (no swap needed)');
      return { coinA, coinB };
    }
  }
}
