import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import { explainError } from '../utils/errorExplainer';
import { setSentryContext, addSentryBreadcrumb, captureException } from '../utils/sentry';
import { calculateQuoteValue } from '../utils/tickMath';

// Fix BigInt JSON serialization
// @ts-expect-error - Extending BigInt prototype for JSON serialization
BigInt.prototype.toJSON = function() { return this.toString(); };

export class RebalanceService {
  private suiClient: SuiClientService;
  private cetusService: CetusService;
  
  constructor(
    suiClient: SuiClientService,
    cetusService: CetusService,
    _config: BotConfig  // Prefix with underscore to indicate intentionally unused
  ) {
    this.suiClient = suiClient;
    this.cetusService = cetusService;
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
      
      const availableA = await this.suiClient.getWalletBalance(pool.coinTypeA);
      const availableB = await this.suiClient.getWalletBalance(pool.coinTypeB);
      
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
      
      addSentryBreadcrumb('Wallet balances queried', 'rebalance', {
        positionId: position.id,
        availableA: availableA.toString(),
        availableB: availableB.toString(),
        valueA: valueA.toString(),
        valueB: valueB.toString(),
        totalValue: totalValue.toString(),
      });
      
      addSentryBreadcrumb('Position closed successfully', 'rebalance', {
        positionId: position.id,
      });
      
      logger.info('=== Position Closure Complete ===');
      
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
}
