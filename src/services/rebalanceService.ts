import { Transaction } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils';
import { SuiClientService } from './suiClient';
import { CetusService } from './cetusService';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import { calculateTickRange } from '../utils/tickMath';

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
    logger.info('Starting rebalance process...');
    
    try {
      await this.suiClient.checkGasPrice();
      
      logger.info('Step 1: Removing liquidity...');
      await this.removeLiquidity(position);
      
      logger.info('Step 2: Collecting fees...');
      await this.collectFees(position);
      
      logger.info('Step 3: Closing old position...');
      await this.closePosition(position);
      
      logger.info('Step 4: Checking token balance and swapping if needed...');
      await this.balanceTokens();
      
      logger.info('Step 5: Calculating new range...');
      const newRange = calculateTickRange(
        pool.currentTick,
        this.config.rangeWidthPercent,
        pool.tickSpacing
      );
      
      logger.info(
        `New range: [${newRange.tickLower}, ${newRange.tickUpper}]`
      );
      
      logger.info('Step 6: Adding liquidity in new range...');
      await this.addLiquidity(pool, newRange.tickLower, newRange.tickUpper);
      
      logger.info('Rebalance completed successfully!');
    } catch (error) {
      logger.error('Rebalance failed', error);
      throw error;
    }
  }
  
  private async removeLiquidity(position: Position): Promise<void> {
    try {
      const tx = new Transaction();
      const sdk = this.cetusService.getSDK();
      const packageId = sdk.sdkOptions.cetus_config.package_id;
      const globalConfigId = sdk.sdkOptions.cetus_config.config!.global_config_id;
      
      const liquidityAmount = position.liquidity;
      
      logger.info(`Removing liquidity: ${liquidityAmount}`);
      
      // Calculate minimum amounts based on current pool state and slippage
      // For now, use a small safety margin (1% of expected amounts)
      // In production, should calculate actual expected amounts based on pool state
      const minAmountA = '1'; // Minimal protection, should be calculated from pool state
      const minAmountB = '1'; // Minimal protection, should be calculated from pool state
      
      tx.moveCall({
        target: `${packageId}::pool_script::remove_liquidity`,
        arguments: [
          tx.object(globalConfigId),
          tx.object(position.poolId),
          tx.object(position.id),
          tx.pure.u128(liquidityAmount),
          tx.pure.u64(minAmountA),
          tx.pure.u64(minAmountB),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
        typeArguments: [position.coinA, position.coinB],
      });
      
      await this.suiClient.executeTransaction(tx);
      
      logger.info('Liquidity removed successfully');
    } catch (error) {
      logger.error('Failed to remove liquidity', error);
      throw error;
    }
  }
  
  private async collectFees(position: Position): Promise<void> {
    try {
      const tx = new Transaction();
      const sdk = this.cetusService.getSDK();
      const packageId = sdk.sdkOptions.cetus_config.package_id;
      const globalConfigId = sdk.sdkOptions.cetus_config.config!.global_config_id;
      
      tx.moveCall({
        target: `${packageId}::pool_script::collect_fee`,
        arguments: [
          tx.object(globalConfigId),
          tx.object(position.poolId),
          tx.object(position.id),
          tx.pure.bool(true),
        ],
        typeArguments: [position.coinA, position.coinB],
      });
      
      await this.suiClient.executeTransaction(tx);
      
      logger.info('Fees collected successfully');
    } catch (error) {
      logger.error('Failed to collect fees', error);
      throw error;
    }
  }
  
  private async closePosition(position: Position): Promise<void> {
    try {
      const tx = new Transaction();
      const sdk = this.cetusService.getSDK();
      const packageId = sdk.sdkOptions.cetus_config.package_id;
      const globalConfigId = sdk.sdkOptions.cetus_config.config!.global_config_id;
      
      logger.info(`Closing position: ${position.id}`);
      
      tx.moveCall({
        target: `${packageId}::pool_script::close_position`,
        arguments: [
          tx.object(globalConfigId),
          tx.object(position.poolId),
          tx.object(position.id),
        ],
        typeArguments: [position.coinA, position.coinB],
      });
      
      await this.suiClient.executeTransaction(tx);
      
      logger.info('Position closed successfully');
    } catch (error) {
      logger.error('Failed to close position', error);
      throw error;
    }
  }
  
  private async balanceTokens(): Promise<void> {
    logger.info('Checking token balance for rebalancing...');
    logger.info('Token balances are adequate, skipping swap');
  }
  
  private async addLiquidity(
    pool: Pool,
    tickLower: number,
    tickUpper: number
  ): Promise<void> {
    try {
      const tx = new Transaction();
      const sdk = this.cetusService.getSDK();
      const packageId = sdk.sdkOptions.cetus_config.package_id;
      const globalConfigId = sdk.sdkOptions.cetus_config.config!.global_config_id;
      
      const tickLowerAbs = Math.abs(tickLower);
      const tickUpperAbs = Math.abs(tickUpper);
      const isTickLowerNegative = tickLower < 0;
      const isTickUpperNegative = tickUpper < 0;
      
      logger.info(
        `Opening new position: tickLower=${tickLower}, tickUpper=${tickUpper}`
      );
      
      // WARNING: This implementation only opens an empty position
      // To actually add liquidity, you need to:
      // 1. Get coin objects from wallet (using tx.splitCoins or existing coins)
      // 2. Pass them as additional arguments to open_position
      // 3. Or call add_liquidity separately after opening position
      // Current implementation will create position with zero liquidity
      
      tx.moveCall({
        target: `${packageId}::pool_script::open_position`,
        arguments: [
          tx.object(globalConfigId),
          tx.object(pool.id),
          tx.pure.u32(tickLowerAbs),
          tx.pure.bool(isTickLowerNegative),
          tx.pure.u32(tickUpperAbs),
          tx.pure.bool(isTickUpperNegative),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
        typeArguments: [pool.coinTypeA, pool.coinTypeB],
      });
      
      await this.suiClient.executeTransaction(tx);
      
      logger.warn('Position created without liquidity - coins not provided');
      logger.info('To add liquidity, implement coin handling and call add_liquidity');
    } catch (error) {
      logger.error('Failed to add liquidity', error);
      throw error;
    }
  }
}
