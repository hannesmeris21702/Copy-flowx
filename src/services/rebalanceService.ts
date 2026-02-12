import { Transaction, TransactionObjectArgument, coinWithBalance } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';
import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import {
  calculateTickRange,
  tickToSqrtPrice,
  getAmountAFromLiquidity,
  getAmountBFromLiquidity,
} from '../utils/tickMath';

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
    const sdk = this.cetusService.getSDK();
    const packageId = sdk.sdkOptions.integrate.published_at;
    const globalConfigId = sdk.sdkOptions.clmm_pool.config!.global_config_id;
    
    logger.info('Building atomic PTB with all operations...');
    logger.info('=== COIN OBJECT FLOW TRACE ===');
    
    // Step 1: Remove liquidity from old position
    // Using SDK format: pool_script::remove_liquidity
    // Returns: [Coin<A>, Coin<B>]
    logger.info('Step 1: Remove liquidity → returns [coinA, coinB]');
    const [removedCoinA, removedCoinB] = ptb.moveCall({
      target: `${packageId}::pool_script::remove_liquidity`,
      arguments: [
        ptb.object(globalConfigId),
        ptb.object(pool.id),
        ptb.object(position.id),
        ptb.pure.u128(position.liquidity),
        ptb.pure.u64(minAmountA.toString()),
        ptb.pure.u64(minAmountB.toString()),
        ptb.object(SUI_CLOCK_OBJECT_ID),
      ],
      typeArguments: [pool.coinTypeA, pool.coinTypeB],
    });
    logger.info('  ✓ Captured: removedCoinA, removedCoinB');
    
    // Step 2: Collect fees from old position
    // Using SDK format: pool_script_v2::collect_fee
    // Returns: [Coin<A>, Coin<B>]
    // Requires zero-value coin inputs
    logger.info('Step 2: Collect fees → returns [feeCoinA, feeCoinB]');
    
    // Create zero-value coins for collect_fee (required by pool_script_v2)
    const zeroCoinA = coinWithBalance({ type: pool.coinTypeA, balance: 0 })(ptb);
    const zeroCoinB = coinWithBalance({ type: pool.coinTypeB, balance: 0 })(ptb);
    
    const [feeCoinA, feeCoinB] = ptb.moveCall({
      target: `${packageId}::pool_script_v2::collect_fee`,
      arguments: [
        ptb.object(globalConfigId),
        ptb.object(pool.id),
        ptb.object(position.id),
        zeroCoinA,
        zeroCoinB,
      ],
      typeArguments: [pool.coinTypeA, pool.coinTypeB],
    });
    logger.info('  ✓ Captured: feeCoinA, feeCoinB');
    
    // Step 3: Merge removed liquidity with collected fees
    // Consumes: feeCoinA into removedCoinA, feeCoinB into removedCoinB
    // After merge: removedCoinA contains (removed + fees), removedCoinB contains (removed + fees)
    logger.info('Step 3: Merge coins');
    logger.info('  mergeCoins(removedCoinA, [feeCoinA]) → removedCoinA now contains both');
    logger.info('  mergeCoins(removedCoinB, [feeCoinB]) → removedCoinB now contains both');
    ptb.mergeCoins(removedCoinA, [feeCoinA]);
    ptb.mergeCoins(removedCoinB, [feeCoinB]);
    logger.info('  ✓ After merge: removedCoinA, removedCoinB contain all funds');
    
    // Step 4: Close old position (cleanup NFT)
    // Using SDK format: pool_script::close_position
    // Takes: config, pool_id, pos_id, min_amount_a, min_amount_b, clock
    // No coin objects returned, just consumes the position NFT
    logger.info('Step 4: Close old position (NFT cleanup, no coins)');
    ptb.moveCall({
      target: `${packageId}::pool_script::close_position`,
      arguments: [
        ptb.object(globalConfigId),
        ptb.object(pool.id),
        ptb.object(position.id),
        ptb.pure.u64(minAmountA.toString()),
        ptb.pure.u64(minAmountB.toString()),
        ptb.object(SUI_CLOCK_OBJECT_ID),
      ],
      typeArguments: [pool.coinTypeA, pool.coinTypeB],
    });
    logger.info('  ✓ Position closed');
    
    // Step 5: Swap to optimal ratio if needed
    // CRITICAL: Swap consumes input coin and returns output coin
    // Must track which coins are valid after swap
    logger.info('Step 5: Swap to optimal ratio (if needed)');
    const { coinA: finalCoinA, coinB: finalCoinB } = this.addSwapIfNeeded(
      ptb,
      pool,
      newRange,
      removedCoinA,
      removedCoinB,
      packageId,
      globalConfigId
    );
    logger.info('  ✓ Final coins ready: finalCoinA, finalCoinB');
    
    // Step 6: Open new position
    // Using SDK format: pool_script::open_position
    // The SDK converts signed ticks to u32 using asUintN(BigInt(tick))
    // Returns: Position NFT
    logger.info('Step 6: Open new position → returns newPosition NFT');
    
    // Convert ticks to u32 format using BigInt.asUintN
    const tickLowerU32 = Number(BigInt.asUintN(32, BigInt(newRange.tickLower)));
    const tickUpperU32 = Number(BigInt.asUintN(32, BigInt(newRange.tickUpper)));
    
    const newPosition = ptb.moveCall({
      target: `${packageId}::pool_script::open_position`,
      arguments: [
        ptb.object(globalConfigId),
        ptb.object(pool.id),
        ptb.pure.u32(tickLowerU32),
        ptb.pure.u32(tickUpperU32),
      ],
      typeArguments: [pool.coinTypeA, pool.coinTypeB],
    });
    logger.info('  ✓ Captured: newPosition NFT');
    
    // Step 7: Add liquidity to new position
    // Using SDK format: pool_script_v2::add_liquidity_by_fix_coin
    // Consumes: finalCoinA, finalCoinB
    // These are the exact coins from remove+collect+swap operations
    logger.info('Step 7: Add liquidity → consumes finalCoinA, finalCoinB');
    
    // Calculate amounts to add - use the coins we have
    // fix_amount_a = true means we'll use all of coinA and calculate needed coinB
    const minAddAmountA = minAmountA;
    const minAddAmountB = minAmountB;
    
    ptb.moveCall({
      target: `${packageId}::pool_script_v2::add_liquidity_by_fix_coin`,
      arguments: [
        ptb.object(globalConfigId),
        ptb.object(pool.id),
        newPosition,
        finalCoinA,  // PROOF: This is the exact coin from swap output or original removedCoinA
        finalCoinB,  // PROOF: This is the exact coin from swap output or original removedCoinB
        ptb.pure.u64(minAddAmountA.toString()),
        ptb.pure.u64(minAddAmountB.toString()),
        ptb.pure.bool(true), // fix_amount_a: use amount A as the fixed amount
        ptb.object(SUI_CLOCK_OBJECT_ID),
      ],
      typeArguments: [pool.coinTypeA, pool.coinTypeB],
    });
    logger.info('  ✓ Liquidity added, coins consumed');
    
    // Step 8: Transfer new position NFT to sender
    logger.info('Step 8: Transfer newPosition NFT to sender');
    ptb.transferObjects([newPosition], ptb.pure.address(this.suiClient.getAddress()));
    logger.info('  ✓ Position transferred');
    
    logger.info('=== END COIN OBJECT FLOW TRACE ===');
    logger.info('PROOF: All coin objects accounted for:');
    logger.info('  - removedCoinA, removedCoinB: created, merged with fees, either used directly or consumed by swap');
    logger.info('  - feeCoinA, feeCoinB: created, merged into removed coins');
    logger.info('  - swap outputs: if swap occurred, replace one of the coins');
    logger.info('  - finalCoinA, finalCoinB: passed to add_liquidity and consumed');
    logger.info('  - newPosition: created, transferred to sender');
    logger.info('NO COIN OBJECTS DROPPED OR UNTRANSFERRED');
    
    return ptb;
  }
  
  private addSwapIfNeeded(
    ptb: Transaction,
    pool: Pool,
    newRange: { tickLower: number; tickUpper: number },
    coinA: TransactionObjectArgument,
    coinB: TransactionObjectArgument,
    packageId: string,
    globalConfigId: string
  ): { coinA: TransactionObjectArgument; coinB: TransactionObjectArgument } {
    // Calculate optimal ratio for new range
    const sqrtPriceCurrent = BigInt(pool.currentSqrtPrice);
    const sqrtPriceLower = tickToSqrtPrice(newRange.tickLower);
    const sqrtPriceUpper = tickToSqrtPrice(newRange.tickUpper);
    
    // Sqrt price limits for swaps (from Cetus SDK - minimum and maximum valid sqrt prices)
    const MIN_SQRT_PRICE = '4295048016';
    const MAX_SQRT_PRICE = '79226673515401279992447579055';
    
    // Maximum u64 value for swap amount (swap all available coins)
    const U64_MAX = '18446744073709551615';
    
    // SDK uses router module for swaps, with both coins as input
    // The coin we're not swapping should be zero-value
    
    if (sqrtPriceCurrent < sqrtPriceLower) {
      // Price below range - need token A
      // Swap ALL of coinB to get more coinA (b2a, a2b=false)
      logger.info('  Price below new range - swapping ALL coinB to coinA');
      
      // For a2b=false (swap B to A), we need coinA with 0 value and coinB with the amount
      const zeroCoinA = coinWithBalance({ type: pool.coinTypeA, balance: 0 })(ptb);
      
      // Using SDK format: router::swap
      const [swappedCoinA, swappedCoinB] = ptb.moveCall({
        target: `${packageId}::router::swap`,
        arguments: [
          ptb.object(globalConfigId),
          ptb.object(pool.id),
          zeroCoinA,  // coin_a (zero value, not consumed)
          coinB,      // coin_b (consumed)
          ptb.pure.bool(false), // a2b: false = B to A
          ptb.pure.bool(true), // by_amount_in: swap exact amount of B
          ptb.pure.u64(U64_MAX), // amount: u64::MAX to swap all
          ptb.pure.u128(MAX_SQRT_PRICE), // sqrt_price_limit
          ptb.pure.bool(false), // use_coin_value: always false per SDK
          ptb.object(SUI_CLOCK_OBJECT_ID),
        ],
        typeArguments: [pool.coinTypeA, pool.coinTypeB],
      });
      
      // Merge the swapped coinA into existing coinA
      ptb.mergeCoins(coinA, [swappedCoinA]);
      logger.info('  ✓ Swapped: coinB consumed, output merged into coinA');
      
      // swappedCoinB should be the leftover/change from coinB (or zero)
      // Use it as the new coinB
      logger.info('  ✓ Using swapped coinB as new coinB');
      return { coinA, coinB: swappedCoinB };
      
    } else if (sqrtPriceCurrent > sqrtPriceUpper) {
      // Price above range - need token B
      // Swap ALL of coinA to get more coinB (a2b, a2b=true)
      logger.info('  Price above new range - swapping ALL coinA to coinB');
      
      // For a2b=true (swap A to B), we need coinB with 0 value and coinA with the amount
      const zeroCoinB = coinWithBalance({ type: pool.coinTypeB, balance: 0 })(ptb);
      
      // Using SDK format: router::swap
      const [swappedCoinA, swappedCoinB] = ptb.moveCall({
        target: `${packageId}::router::swap`,
        arguments: [
          ptb.object(globalConfigId),
          ptb.object(pool.id),
          coinA,      // coin_a (consumed)
          zeroCoinB,  // coin_b (zero value, not consumed)
          ptb.pure.bool(true), // a2b: true = A to B
          ptb.pure.bool(true), // by_amount_in: swap exact amount of A
          ptb.pure.u64(U64_MAX), // amount: u64::MAX to swap all
          ptb.pure.u128(MIN_SQRT_PRICE), // sqrt_price_limit
          ptb.pure.bool(false), // use_coin_value: always false per SDK
          ptb.object(SUI_CLOCK_OBJECT_ID),
        ],
        typeArguments: [pool.coinTypeA, pool.coinTypeB],
      });
      
      // Merge the swapped coinB into existing coinB
      ptb.mergeCoins(coinB, [swappedCoinB]);
      logger.info('  ✓ Swapped: coinA consumed, output merged into coinB');
      
      // swappedCoinA should be the leftover/change from coinA (or zero)
      // Use it as the new coinA
      logger.info('  ✓ Using swapped coinA as new coinA');
      return { coinA: swappedCoinA, coinB };
      
    } else {
      // Price in range - need both tokens in proportion
      // Use coins as-is without swapping
      logger.info('  Price in new range - using both coins as-is');
      return { coinA, coinB };
    }
  }
}
