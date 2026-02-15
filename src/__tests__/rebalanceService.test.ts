/**
 * Tests for RebalanceService
 */

import { RebalanceService } from '../services/rebalanceService';
import { BotConfig, Pool } from '../types';
import { logger } from '../utils/logger';

// Mock dependencies
jest.mock('../utils/logger');
jest.mock('../utils/sentry');
jest.mock('../utils/botLogger');

describe('RebalanceService', () => {
  let rebalanceService: RebalanceService;
  let mockSuiClient: any;
  let mockCetusService: any;
  let mockConfig: BotConfig;
  let mockPool: Pool;
  let mockSDK: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      rpcUrl: 'https://fullnode.mainnet.sui.io:443',
      poolId: '0xpool123',
      rebalanceThresholdPercent: 2.0,
      rangeWidthPercent: 5.0,
      checkIntervalMs: 60000,
      maxSlippagePercent: 1.0,
      maxGasPrice: 1000000000,
      minRetryDelayMs: 1000,
      maxRetryDelayMs: 30000,
      maxRetries: 3,
      swapRatioTolerancePercent: 5.0,
    };

    mockPool = {
      id: '0xpool123',
      coinTypeA: '0xTokenA',
      coinTypeB: '0xTokenB',
      currentSqrtPrice: '1000000000000000000',
      currentTick: 100,
      tickSpacing: 10,
      feeRate: 3000,
    };

    mockSDK = {
      Position: {
        getPositionById: jest.fn(),
        closePositionTransactionPayload: jest.fn().mockResolvedValue({}),
        createAddLiquidityFixTokenPayload: jest.fn().mockResolvedValue({}),
      },
      Swap: {
        createSwapTransactionPayload: jest.fn().mockResolvedValue({}),
      },
    };

    mockSuiClient = {
      getWalletPositions: jest.fn(),
      getWalletBalance: jest.fn().mockResolvedValue(BigInt('1000000')),
      executeSDKPayload: jest.fn(),
      checkGasPrice: jest.fn().mockResolvedValue(undefined),
    };

    mockCetusService = {
      getSDK: jest.fn().mockReturnValue(mockSDK),
      getPool: jest.fn().mockResolvedValue(mockPool),
    };

    rebalanceService = new RebalanceService(
      mockSuiClient,
      mockCetusService,
      mockConfig
    );
  });

  /**
   * TEST 1: Wallet has NO positions
   */
  it('TEST 1: should exit safely when wallet has no positions', async () => {
    mockSuiClient.getWalletPositions.mockResolvedValue([]);

    await rebalanceService.rebalance(mockPool);

    expect(mockSuiClient.getWalletPositions).toHaveBeenCalledTimes(1);
    expect(mockSDK.Position.getPositionById).not.toHaveBeenCalled();
    expect(mockSuiClient.executeSDKPayload).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('No positions found in wallet - nothing to rebalance');
  });

  /**
   * TEST 2: Wallet has position IN RANGE
   */
  it('TEST 2: should do nothing when all positions are in range', async () => {
    const positionId = '0xposition123';
    mockSuiClient.getWalletPositions.mockResolvedValue([positionId]);

    mockSDK.Position.getPositionById.mockResolvedValue({
      pos_object_id: positionId,
      pool: mockPool.id,
      tick_lower_index: 50,
      tick_upper_index: 150,
      liquidity: '1000000',
      coin_type_a: mockPool.coinTypeA,
      coin_type_b: mockPool.coinTypeB,
    });

    await rebalanceService.rebalance(mockPool);

    expect(mockSDK.Position.getPositionById).toHaveBeenCalledTimes(1);
    expect(mockSDK.Position.closePositionTransactionPayload).not.toHaveBeenCalled();
    expect(mockSuiClient.executeSDKPayload).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('All positions are IN_RANGE - no rebalance needed');
  });

  /**
   * TEST 3: Wallet has position OUT OF RANGE
   */
  it('TEST 3: should execute full rebalance when position is out of range', async () => {
    const oldPositionId = '0xposition123';
    const newPositionId = '0xnewposition456';
    
    mockSuiClient.getWalletPositions.mockResolvedValue([oldPositionId]);

    mockSDK.Position.getPositionById.mockResolvedValue({
      pos_object_id: oldPositionId,
      pool: mockPool.id,
      tick_lower_index: 200,
      tick_upper_index: 300,
      liquidity: '1000000',
      coin_type_a: mockPool.coinTypeA,
      coin_type_b: mockPool.coinTypeB,
    });

    let callCount = 0;
    mockSuiClient.executeSDKPayload.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ digest: '0xtxn1' });
      } else {
        return Promise.resolve({
          digest: '0xtxn2',
          objectChanges: [{
            type: 'created',
            objectType: '0x::position::Position',
            objectId: newPositionId,
          }],
        });
      }
    });

    await rebalanceService.rebalance(mockPool);

    expect(mockSDK.Position.closePositionTransactionPayload).toHaveBeenCalled();
    expect(mockSDK.Position.createAddLiquidityFixTokenPayload).toHaveBeenCalled();
    expect(mockSuiClient.executeSDKPayload).toHaveBeenCalledTimes(2);
  });

  /**
   * TEST 4: Wallet only has one token after close
   */
  it('TEST 4: should execute swap when only one token is available', async () => {
    const oldPositionId = '0xposition123';
    const newPositionId = '0xnewposition456';
    
    mockSuiClient.getWalletPositions.mockResolvedValue([oldPositionId]);

    mockSDK.Position.getPositionById.mockResolvedValue({
      pos_object_id: oldPositionId,
      pool: mockPool.id,
      tick_lower_index: 200,
      tick_upper_index: 300,
      liquidity: '1000000',
      coin_type_a: mockPool.coinTypeA,
      coin_type_b: mockPool.coinTypeB,
    });

    let callCount = 0;
    mockSuiClient.executeSDKPayload.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ digest: '0xtxn1' });
      } else if (callCount === 2) {
        return Promise.resolve({ digest: '0xtxnSwap' });
      } else {
        return Promise.resolve({
          digest: '0xtxn2',
          objectChanges: [{
            type: 'created',
            objectType: '0x::position::Position',
            objectId: newPositionId,
          }],
        });
      }
    });

    mockSuiClient.getWalletBalance
      .mockResolvedValueOnce(BigInt('2000000'))
      .mockResolvedValueOnce(BigInt('0'))
      .mockResolvedValueOnce(BigInt('1000000'))
      .mockResolvedValueOnce(BigInt('1000000'));

    await rebalanceService.rebalance(mockPool);

    expect(mockSDK.Swap.createSwapTransactionPayload).toHaveBeenCalled();
    expect(mockSuiClient.executeSDKPayload).toHaveBeenCalledTimes(3);
  });

  /**
   * TEST 5: Wallet balances match required ratio
   */
  it('TEST 5: should skip swap when balances match required ratio', async () => {
    const oldPositionId = '0xposition123';
    const newPositionId = '0xnewposition456';
    
    mockSuiClient.getWalletPositions.mockResolvedValue([oldPositionId]);

    mockSDK.Position.getPositionById.mockResolvedValue({
      pos_object_id: oldPositionId,
      pool: mockPool.id,
      tick_lower_index: 200,
      tick_upper_index: 300,
      liquidity: '1000000',
      coin_type_a: mockPool.coinTypeA,
      coin_type_b: mockPool.coinTypeB,
    });

    let callCount = 0;
    mockSuiClient.executeSDKPayload.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ digest: '0xtxn1' });
      } else {
        return Promise.resolve({
          digest: '0xtxn2',
          objectChanges: [{
            type: 'created',
            objectType: '0x::position::Position',
            objectId: newPositionId,
          }],
        });
      }
    });

    await rebalanceService.rebalance(mockPool);

    expect(mockSDK.Swap.createSwapTransactionPayload).not.toHaveBeenCalled();
    expect(mockSuiClient.executeSDKPayload).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Swap is NOT REQUIRED'));
  });

  /**
   * TEST 6: addLiquidity validation failure
   */
  it('TEST 6: should abort safely when both token amounts are zero', async () => {
    const oldPositionId = '0xposition123';
    
    mockSuiClient.getWalletPositions.mockResolvedValue([oldPositionId]);

    mockSDK.Position.getPositionById.mockResolvedValue({
      pos_object_id: oldPositionId,
      pool: mockPool.id,
      tick_lower_index: 200,
      tick_upper_index: 300,
      liquidity: '1000000',
      coin_type_a: mockPool.coinTypeA,
      coin_type_b: mockPool.coinTypeB,
    });

    mockSuiClient.executeSDKPayload.mockResolvedValue({ digest: '0xtxn1' });
    mockSuiClient.getWalletBalance.mockResolvedValue(BigInt('0'));

    await expect(rebalanceService.rebalance(mockPool)).rejects.toThrow(
      'Cannot add liquidity: both token amounts are zero'
    );

    expect(mockSDK.Position.createAddLiquidityFixTokenPayload).not.toHaveBeenCalled();
  });

  /**
   * TEST 7: Indexer delay after mint
   */
  it('TEST 7: should not call getPositionById after opening position', async () => {
    const oldPositionId = '0xposition123';
    const newPositionId = '0xnewposition456';
    
    mockSuiClient.getWalletPositions.mockResolvedValue([oldPositionId]);

    mockSDK.Position.getPositionById.mockResolvedValueOnce({
      pos_object_id: oldPositionId,
      pool: mockPool.id,
      tick_lower_index: 200,
      tick_upper_index: 300,
      liquidity: '1000000',
      coin_type_a: mockPool.coinTypeA,
      coin_type_b: mockPool.coinTypeB,
    });

    let callCount = 0;
    mockSuiClient.executeSDKPayload.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ digest: '0xtxn1' });
      } else {
        return Promise.resolve({
          digest: '0xtxn2',
          objectChanges: [{
            type: 'created',
            objectType: '0x::position::Position',
            objectId: newPositionId,
          }],
        });
      }
    });

    await rebalanceService.rebalance(mockPool);

    expect(mockSDK.Position.getPositionById).toHaveBeenCalledTimes(1);
    expect(mockSDK.Position.getPositionById).toHaveBeenCalledWith(oldPositionId);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(newPositionId));
  });
});
