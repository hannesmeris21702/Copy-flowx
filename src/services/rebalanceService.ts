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
    // Step 3: Merge removed liquidity with collected fees
    // PTB Note: feeCoin objects always exist even with zero balance
    // mergeCoins handles zero-balance coins gracefully - merge operation is safe
    // mergeCoins(target: removedCoinA from close_position, sources: [feeCoinA from collect_fee])
    // mergeCoins(target: removedCoinB from close_position, sources: [feeCoinB from collect_fee])
    // ============================================================================
    logger.info('Step 3: Merge coins (handles zero-fee case gracefully)');
    
    // Merge for coinA: feeCoinA = result[2][0] into removedCoinA = result[3][0]
    // Safe even if fees are zero - PTB mergeCoins handles zero-balance sources
    const sourcesA = [feeCoinA];  // feeCoinA = result[2][0]
    if (sourcesA.length > 0) {
      ptb.mergeCoins(removedCoinA, sourcesA);  // Command 4: Merge result[2][0] into result[3][0]
      logger.info('  ✓ Merged feeCoinA (result[2][0]) into removedCoinA (result[3][0])');
    } else {
      logger.info('  ⊘ Skipped merge for coinA (no fee sources)');
    }
    
    // Merge for coinB: feeCoinB = result[2][1] into removedCoinB = result[3][1]
    // Safe even if fees are zero - PTB mergeCoins handles zero-balance sources
    const sourcesB = [feeCoinB];  // feeCoinB = result[2][1]
    if (sourcesB.length > 0) {
      ptb.mergeCoins(removedCoinB, sourcesB);  // Command 5: Merge result[2][1] into result[3][1]
      logger.info('  ✓ Merged feeCoinB (result[2][1]) into removedCoinB (result[3][1])');
    } else {
      logger.info('  ⊘ Skipped merge for coinB (no fee sources)');
    }
    
    logger.info('  ✓ After merge: removedCoinA, removedCoinB contain all funds (liquidity + fees)');
    
    // Step 4: Swap to optimal ratio if needed
    logger.info('Step 4: Swap to optimal ratio (if needed)');
    const { coinA: finalCoinA, coinB: finalCoinB } = this.addSwapIfNeeded(
      ptb,
      pool,
      newRange,
      removedCoinA,
      removedCoinB,
      packageId,
      globalConfigId,
      normalizedCoinTypeA,
      normalizedCoinTypeB
    );
    logger.info('  ✓ Final coins ready: finalCoinA, finalCoinB');
    
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
    logger.info('Step 6: Add liquidity → consumes finalCoinA, finalCoinB');
    
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
    
    // Step 7: Transfer new position NFT to sender
    logger.info('Step 7: Transfer newPosition NFT to sender');
    ptb.transferObjects([newPosition], ptb.pure.address(this.suiClient.getAddress()));
    logger.info('  ✓ Position transferred');
    
    logger.info('=== END COIN OBJECT FLOW TRACE ===');
    logger.info('Flow: zeroCoin creation → collect_fee → close_position (removes liquidity) → merge → swap (if needed) → open → add_liquidity → transfer');
    logger.info('NO COIN OBJECTS DROPPED OR UNTRANSFERRED');
    
    // Add PTB validation: Print commands before build (as requested in problem statement)
    // Using console.log (not logger) for direct output as specified in requirements
    const ptbData = ptb.getData();
    console.log('=== PTB COMMANDS VALIDATION ===');
    console.log(`Total commands: ${ptbData.commands.length}`);
    ptbData.commands.forEach((cmd: any, idx: number) => {
      console.log(`Command ${idx}: ${JSON.stringify(cmd)}`);
    });
    console.log('=== END PTB COMMANDS ===');
    
    return ptb;
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
    normalizedCoinTypeB: string
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
      logger.info('  Price below new range - swapping ALL coinB to coinA');
      
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
      
      ptb.mergeCoins(coinA, [swappedCoinA]);
      logger.info('  ✓ Swapped: coinB consumed, output merged into coinA');
      
      return { coinA, coinB: remainderCoinB };
      
    } else if (sqrtPriceCurrent > sqrtPriceUpper) {
      // Price above range - need token B, swap A to B
      logger.info('  Price above new range - swapping ALL coinA to coinB');
      
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
      
      ptb.mergeCoins(coinB, [swappedCoinB]);
      logger.info('  ✓ Swapped: coinA consumed, output merged into coinB');
      
      return { coinA: remainderCoinA, coinB };
      
    } else {
      // Price in range - use both tokens as-is
      logger.info('  Price in new range - using both coins as-is');
      return { coinA, coinB };
    }
  }
}
