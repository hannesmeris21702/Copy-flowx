/**
 * Integration tests for RebalanceService
 * Tests the simple zap-based rebalancing logic
 */

import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';

// Mock external dependencies
jest.mock('@cetusprotocol/cetus-sui-clmm-sdk', () => ({
  initMainnetSDK: jest.fn().mockReturnValue({
    Position: {
      closePositionTransactionPayload: jest.fn(),
      openPositionTransactionPayload: jest.fn(),
      createAddLiquidityFixTokenPayload: jest.fn(),
    },
    senderAddress: '',
  }),
}));

jest.mock('../services/suiClient');
jest.mock('../utils/logger');
jest.mock('../utils/sentry');

import { RebalanceService } from '../services/rebalanceService';

describe('RebalanceService Integration Tests', () => {
  let mockConfig: BotConfig;
  let mockPool: Pool;
  let mockSuiClient: any;
  let mockCetusService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      rpcUrl: 'https://fullnode.mainnet.sui.io:443',
      network: 'mainnet',
      checkIntervalMs: 60000,
      rangeWidthPercent: 5.0,
    };

    mockPool = {
      id: '0xpool123',
      coinTypeA: '0x2::sui::SUI',
      coinTypeB: '0xtoken::usdc::USDC',
      currentTick: 12000,
      tickSpacing: 10,
    };

    mockSuiClient = {
      getAddress: jest.fn().mockReturnValue('0xwalletaddress'),
      executeTransaction: jest.fn().mockResolvedValue({
        digest: '0xtxdigest',
        effects: { status: { status: 'success' } },
        objectChanges: [
          {
            type: 'created',
            objectType: '0x::position::Position',
            objectId: '0xnewposition123',
          },
        ],
      }),
      getWalletBalance: jest.fn().mockResolvedValue(BigInt(1000000)),
    };

    mockCetusService = {
      getSDK: jest.fn().mockReturnValue({
        Position: {
          closePositionTransactionPayload: jest.fn().mockResolvedValue({}),
          openPositionTransactionPayload: jest.fn().mockResolvedValue({}),
          createAddLiquidityFixTokenPayload: jest.fn().mockResolvedValue({}),
        },
      }),
      isPositionInRange: jest.fn(),
      calculateNewRange: jest.fn().mockReturnValue({
        tickLower: 11500,
        tickUpper: 12500,
      }),
    };
  });

  describe('TEST 1: Position IN_RANGE', () => {
    it('should not rebalance when position is in range', async () => {
      const position: Position = {
        id: '0xposition123',
        poolId: '0xpool123',
        liquidity: '1000000',
        coinTypeA: '0x2::sui::SUI',
        coinTypeB: '0xtoken::usdc::USDC',
        tickLower: 11000,
        tickUpper: 13000,
      };

      mockCetusService.isPositionInRange.mockReturnValue(true);

      const rebalanceService = new RebalanceService(
        mockSuiClient,
        mockCetusService,
        mockConfig
      );

      await rebalanceService.checkAndRebalance(position, mockPool);

      // Should log IN_RANGE
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('IN_RANGE'));

      // Should NOT execute any transactions
      expect(mockSuiClient.executeTransaction).not.toHaveBeenCalled();
    });
  });

  describe('TEST 2: Position OUT_OF_RANGE', () => {
    it('should rebalance when position is out of range', async () => {
      const position: Position = {
        id: '0xposition123',
        poolId: '0xpool123',
        liquidity: '1000000',
        coinTypeA: '0x2::sui::SUI',
        coinTypeB: '0xtoken::usdc::USDC',
        tickLower: 10000,
        tickUpper: 11000,
      };

      mockCetusService.isPositionInRange.mockReturnValue(false);

      const rebalanceService = new RebalanceService(
        mockSuiClient,
        mockCetusService,
        mockConfig
      );

      await rebalanceService.checkAndRebalance(position, mockPool);

      // Should log OUT_OF_RANGE
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('OUT_OF_RANGE'));

      // Should execute transactions:
      // 1. Close position
      // 2. Open new position
      // 3. Add liquidity
      expect(mockSuiClient.executeTransaction).toHaveBeenCalledTimes(3);

      // Should log success
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Rebalance completed'));
    });
  });

  describe('TEST 3: Rebalance with error', () => {
    it('should handle rebalance errors gracefully', async () => {
      const position: Position = {
        id: '0xposition123',
        poolId: '0xpool123',
        liquidity: '1000000',
        coinTypeA: '0x2::sui::SUI',
        coinTypeB: '0xtoken::usdc::USDC',
        tickLower: 10000,
        tickUpper: 11000,
      };

      mockCetusService.isPositionInRange.mockReturnValue(false);
      mockSuiClient.executeTransaction.mockRejectedValueOnce(new Error('Transaction failed'));

      const rebalanceService = new RebalanceService(
        mockSuiClient,
        mockCetusService,
        mockConfig
      );

      await expect(
        rebalanceService.checkAndRebalance(position, mockPool)
      ).rejects.toThrow('Transaction failed');

      // Should log error
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Rebalance failed'), expect.any(Error));
    });
  });
});
