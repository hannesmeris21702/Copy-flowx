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
    logger.info('Order: create zero coins → collect_fee → close_position (removes liquidity) → create placeholders → merge fees (always) → merge liquidity (if exists) → swap → open → add_liquidity → transfer');
    
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
    // May return variable outputs: [Coin<A>, Coin<B>], [Coin<A>], [Coin<B>], or []
    // depending on position liquidity and which side has balance
    // ============================================================================
    logger.info('Step 2: Close position (removes liquidity & closes NFT) → may return 0-2 coins');
    
    // Command 3: close_position moveCall
    // May return [Coin<A>, Coin<B>], [Coin<A>], [Coin<B>], or [] depending on liquidity
    // DO NOT destructure immediately - handle conditionally based on position liquidity
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
    // NOTE: closePositionResult is NOT destructured here to avoid SecondaryIndexOutOfBounds
    // We'll conditionally reference indices only when we know outputs exist
    logger.info('  ✓ close_position called (outputs will be conditionally referenced)');
    
    // ============================================================================
    // Step 3: Create placeholder coins and merge safely
    // 
    // IMPORTANT DISTINCTION:
    // - collect_fee ALWAYS returns coins (even if amounts are 0), so can be merged unconditionally
    // - close_position returns coins ONLY if amounts > 0, so must be merged conditionally
    // 
    // When position is out of range, one side of close_position may be 0 and won't be returned.
    // We handle this by checking position liquidity before destructuring close_position results.
    // 
    // Official @mysten/sui Pattern:
    // 1. Create stable coin references that always exist (splitCoins from zero coins)
    // 2. Merge collect_fee results unconditionally (they always exist)
    // 3. Conditionally merge close_position results only when position has liquidity
    // ============================================================================
    logger.info('Step 3: Create placeholder coins and merge fees and liquidity safely');
    
    // Create placeholder coins using splitCoins with zero amounts
    // These serve as guaranteed-valid coin references for downstream operations
    const [placeholderA] = ptb.splitCoins(zeroCoinA, [ptb.pure.u64(0)]);  // Command 4: Create placeholder coinA
    const [placeholderB] = ptb.splitCoins(zeroCoinB, [ptb.pure.u64(0)]);  // Command 5: Create placeholder coinB
    logger.info('  ✓ Created placeholder coin references via splitCoins(zeroCoin, [0])');
    
    // Initialize our working coins with the placeholders
    let workingCoinA = placeholderA;
    let workingCoinB = placeholderB;
    
    // ============================================================================
    // STEP 1: Merge collect_fee results FIRST (ALWAYS - fees always returned)
    // collect_fee returns coins even if the fee amounts are 0, so these can always be safely merged
    // ============================================================================
    logger.info('  Merging collect_fee results (always safe - fees always returned even if 0)');
    ptb.mergeCoins(workingCoinA, [feeCoinA]);  // Always safe: collect_fee always returns feeCoinA
    ptb.mergeCoins(workingCoinB, [feeCoinB]);  // Always safe: collect_fee always returns feeCoinB
    logger.info('  ✓ Merged collect_fee outputs (feeCoinA and feeCoinB) into working coins');
    
    // ============================================================================
    // STEP 2: Conditionally merge close_position results (ONLY if position has liquidity)
    // close_position returns (Coin<A>, Coin<B>) but ONLY if amounts > 0
    // When position is out of range, one side may be 0 and the coin won't be returned
    // We need to check position liquidity BEFORE destructuring to avoid SecondaryIndexOutOfBounds
    // ============================================================================
    logger.debug(`  CHECK: close_position outputs - position.liquidity=${position.liquidity}, hasLiquidity=${positionHasLiquidity}`);
    if (positionHasLiquidity) {
      // Position has liquidity: close_position will return coins, safe to destructure and merge
      // Only NOW do we create the NestedResult references because we know they'll exist
      logger.info('  Position has liquidity - merging close_position results');
      const [removedCoinA, removedCoinB] = closePositionResult;  // Safe: outputs exist when hasLiquidity=true
      ptb.mergeCoins(workingCoinA, [removedCoinA]);  // Merge removed liquidity into working coinA
      ptb.mergeCoins(workingCoinB, [removedCoinB]);  // Merge removed liquidity into working coinB
      logger.info('  ✓ Merged close_position outputs (removedCoinA and removedCoinB) into working coins');
    } else {
      // Position has zero liquidity: close_position returns no coins, skip merge safely
      // DO NOT reference closePositionResult[0] or [1] - they don't exist
      logger.warn('  ⚠ Skipped close_position merge: position has zero liquidity, no coins returned');
    }
    
    logger.info('  ✓ Merge complete: working coins ready for swap operations');
    
    // Step 4: Swap to optimal ratio if needed
    logger.info('Step 4: Swap to optimal ratio (if needed)');
    const { coinA: swappedCoinA, coinB: swappedCoinB } = this.addSwapIfNeeded(
      ptb,
      pool,
      newRange,
      workingCoinA,
      workingCoinB,
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
    
    // Validate MergeCoins references to collect_fee results
    // This prevents invalid PTB construction where MergeCoins references collect_fee
    // results that may not exist
    this.validateCollectFeeMergeCoins(ptb, positionHasLiquidity);
    
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
  
  /**
   * Validates that MergeCoins commands do not reference collect_fee results unless they exist.
   * This prevents invalid PTB construction where MergeCoins tries to merge fee coins that
   * were not actually returned by collect_fee (e.g., when position has zero liquidity).
   * 
   * @param ptb - The Transaction to validate
   * @param positionHasLiquidity - Whether the position has liquidity (determines if fee coins exist)
   * @throws Error if MergeCoins references collect_fee results when they shouldn't exist
   */
  private validateCollectFeeMergeCoins(ptb: Transaction, positionHasLiquidity: boolean): void {
    const ptbData = ptb.getData();
    
    // Dynamically find the collect_fee command by searching for the moveCall
    // This is more robust than hardcoding the index
    let collectFeeCommandIndex = -1;
    ptbData.commands.forEach((cmd: unknown, idx: number) => {
      if (typeof cmd === 'object' && cmd !== null && '$kind' in cmd && cmd.$kind === 'MoveCall') {
        const moveCallData = (cmd as any).MoveCall;
        if (moveCallData?.target?.includes('collect_fee')) {
          collectFeeCommandIndex = idx;
        }
      }
    });
    
    // If no collect_fee command found, no validation needed
    if (collectFeeCommandIndex === -1) {
      logger.debug('No collect_fee command found in PTB, skipping validation');
      return;
    }
    
    logger.debug(`Validating MergeCoins references to collect_fee results (command ${collectFeeCommandIndex})`);
    logger.debug(`Position has liquidity: ${positionHasLiquidity}`);
    
    // Helper function to check if an argument references collect_fee results
    const referencesCollectFee = (arg: unknown): boolean => {
      if (!arg || typeof arg !== 'object') {
        return false;
      }
      
      // Check if this is a NestedResult referencing collect_fee command
      if ('$kind' in arg && arg.$kind === 'NestedResult' && 'NestedResult' in arg && Array.isArray(arg.NestedResult)) {
        const [commandIndex] = arg.NestedResult;
        return commandIndex === collectFeeCommandIndex;
      }
      
      // Recursively check arrays and objects
      if (Array.isArray(arg)) {
        return arg.some(item => referencesCollectFee(item));
      }
      
      return Object.values(arg).some(value => referencesCollectFee(value));
    };
    
    // Check each command for MergeCoins referencing collect_fee
    ptbData.commands.forEach((cmd: unknown, idx: number) => {
      // Check if this is a MergeCoins command
      if (typeof cmd === 'object' && cmd !== null && '$kind' in cmd && cmd.$kind === 'MergeCoins') {
        const mergeCoinsData = (cmd as any).MergeCoins;
        const sources = mergeCoinsData?.sources || [];
        
        // Check if any source references collect_fee results
        const hasCollectFeeReference = sources.some((source: unknown) => referencesCollectFee(source));
        
        if (hasCollectFeeReference) {
          logger.debug(`  Command ${idx} (MergeCoins) references collect_fee results`);
          
          // If position has no liquidity, MergeCoins should not reference collect_fee
          if (!positionHasLiquidity) {
            throw new Error(
              `Invalid PTB construction: MergeCoins at command ${idx} references ` +
              `collect_fee results (command ${collectFeeCommandIndex}), but position has zero liquidity. ` +
              `Fee coins do not exist and cannot be merged. ` +
              `This indicates a bug in the conditional guards.`
            );
          }
          
          logger.debug(`  ✓ Valid: MergeCoins references collect_fee and position has liquidity`);
        }
      }
    });
    
    logger.info(`✓ MergeCoins validation passed: no invalid references to collect_fee results`);
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
      logger.debug('  Merging swap remainder (remainderCoinB) into coinB');
      ptb.mergeCoins(coinB, [remainderCoinB]);
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
      logger.debug('  Merging swap remainder (remainderCoinA) into coinA');
      ptb.mergeCoins(coinA, [remainderCoinA]);
      logger.info('  ✓ Swapped: coinA to coinB, output and remainder merged into stable coins');
      
      return { coinA, coinB };
      
    } else {
      // Price in range - use both tokens as-is
      logger.info('  Price in new range - using both coins as-is (no swap needed)');
      return { coinA, coinB };
    }
  }
}
