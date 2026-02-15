/**
 * Integration tests for PositionScanner
 * Tests the bot's ability to scan wallets and detect positions
 */

import { BotConfig } from '../types';
import { logger } from '../utils/logger';

// Mock external dependencies before importing PositionScanner
jest.mock('@cetusprotocol/cetus-sui-clmm-sdk', () => ({
  initMainnetSDK: jest.fn().mockReturnValue({
    Position: {
      getPositionById: jest.fn(),
    },
    senderAddress: '',
  }),
  CetusClmmSDK: jest.fn(),
}));

jest.mock('../services/suiClient');
jest.mock('../utils/logger');
jest.mock('../utils/sentry');

import { PositionScanner } from '../services/positionScanner';
import { initMainnetSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';

describe('PositionScanner Integration Tests', () => {
  let mockConfig: BotConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      rpcUrl: 'https://fullnode.mainnet.sui.io:443',
      network: 'mainnet',
      checkIntervalMs: 60000,
      rangeWidthPercent: 5.0,
    };
  });

  describe('TEST 1: Wallet with 0 positions', () => {
    it('should exit cleanly when wallet has no positions', async () => {
      // Mock the SuiClient to return no positions
      const mockSuiClient = {
        getAddress: jest.fn().mockReturnValue('0xwalletaddress'),
        getWalletPositions: jest.fn().mockResolvedValue([]),
      };

      const scanner = new PositionScanner(mockConfig);
      
      // Replace the internal client with our mock
      (scanner as any).suiClient = mockSuiClient;

      await scanner.scan();

      // Verify wallet positions were queried
      expect(mockSuiClient.getWalletPositions).toHaveBeenCalledTimes(1);

      // Verify appropriate log messages
      expect(logger.info).toHaveBeenCalledWith('=== Scanning Wallet for CLMM Positions ===');
      expect(logger.info).toHaveBeenCalledWith('✓ No CLMM positions found in wallet');
      expect(logger.info).toHaveBeenCalledWith('  Your wallet does not contain any position NFTs');
    });
  });

  describe('TEST 2: Wallet with 1 position with liquidity', () => {
    it('should log position ID and liquidity when position exists', async () => {
      const mockPositionId = '0xposition123';
      const mockPositionData = {
        pos_object_id: mockPositionId,
        pool: '0xpool456',
        liquidity: '1000000',
        coin_type_a: '0x2::sui::SUI',
        coin_type_b: '0xtoken::usdc::USDC',
      };

      // Mock the SuiClient
      const mockSuiClient = {
        getAddress: jest.fn().mockReturnValue('0xwalletaddress'),
        getWalletPositions: jest.fn().mockResolvedValue([mockPositionId]),
      };

      // Mock the SDK
      const mockSDK = {
        Position: {
          getPositionById: jest.fn().mockResolvedValue(mockPositionData),
        },
        senderAddress: '',
      };

      (initMainnetSDK as jest.Mock).mockReturnValue(mockSDK);

      const scanner = new PositionScanner(mockConfig);
      
      // Replace the internal client with our mock
      (scanner as any).suiClient = mockSuiClient;

      await scanner.scan();

      // Verify wallet positions were queried
      expect(mockSuiClient.getWalletPositions).toHaveBeenCalledTimes(1);

      // Verify position data was fetched
      expect(mockSDK.Position.getPositionById).toHaveBeenCalledWith(mockPositionId);

      // Verify appropriate log messages about finding positions
      expect(logger.info).toHaveBeenCalledWith('Found 1 position NFT(s) in wallet');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Found 1 position(s) with active liquidity'));
      expect(logger.info).toHaveBeenCalledWith(`Position ID: ${mockPositionId}`);
      expect(logger.info).toHaveBeenCalledWith(`Pool ID:     ${mockPositionData.pool}`);
      expect(logger.info).toHaveBeenCalledWith(`Liquidity:   ${mockPositionData.liquidity}`);
    });
  });

  describe('TEST 3: Wallet with multiple positions', () => {
    it('should log all positions with liquidity', async () => {
      const mockPosition1 = {
        pos_object_id: '0xposition1',
        pool: '0xpool1',
        liquidity: '5000000',
        coin_type_a: '0x2::sui::SUI',
        coin_type_b: '0xtoken::usdc::USDC',
      };

      const mockPosition2 = {
        pos_object_id: '0xposition2',
        pool: '0xpool2',
        liquidity: '3000000',
        coin_type_a: '0x2::sui::SUI',
        coin_type_b: '0xtoken::usdt::USDT',
      };

      // Mock the SuiClient
      const mockSuiClient = {
        getAddress: jest.fn().mockReturnValue('0xwalletaddress'),
        getWalletPositions: jest.fn().mockResolvedValue(['0xposition1', '0xposition2']),
      };

      // Mock the SDK
      const mockSDK = {
        Position: {
          getPositionById: jest.fn()
            .mockResolvedValueOnce(mockPosition1)
            .mockResolvedValueOnce(mockPosition2),
        },
        senderAddress: '',
      };

      (initMainnetSDK as jest.Mock).mockReturnValue(mockSDK);

      const scanner = new PositionScanner(mockConfig);
      
      // Replace the internal client with our mock
      (scanner as any).suiClient = mockSuiClient;

      await scanner.scan();

      // Verify appropriate log messages
      expect(logger.info).toHaveBeenCalledWith('Found 2 position NFT(s) in wallet');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Found 2 position(s) with active liquidity'));
      expect(logger.info).toHaveBeenCalledWith(`Position ID: ${mockPosition1.pos_object_id}`);
      expect(logger.info).toHaveBeenCalledWith(`Position ID: ${mockPosition2.pos_object_id}`);
    });
  });

  describe('TEST 4: Wallet with position but 0 liquidity', () => {
    it('should not log positions with zero liquidity', async () => {
      const mockPositionId = '0xposition123';
      const mockPositionData = {
        pos_object_id: mockPositionId,
        pool: '0xpool456',
        liquidity: '0', // Zero liquidity
        coin_type_a: '0x2::sui::SUI',
        coin_type_b: '0xtoken::usdc::USDC',
      };

      // Mock the SuiClient
      const mockSuiClient = {
        getAddress: jest.fn().mockReturnValue('0xwalletaddress'),
        getWalletPositions: jest.fn().mockResolvedValue([mockPositionId]),
      };

      // Mock the SDK
      const mockSDK = {
        Position: {
          getPositionById: jest.fn().mockResolvedValue(mockPositionData),
        },
        senderAddress: '',
      };

      (initMainnetSDK as jest.Mock).mockReturnValue(mockSDK);

      const scanner = new PositionScanner(mockConfig);
      
      // Replace the internal client with our mock
      (scanner as any).suiClient = mockSuiClient;

      await scanner.scan();

      // Verify appropriate log messages
      expect(logger.info).toHaveBeenCalledWith('Found 1 position NFT(s) in wallet');
      expect(logger.info).toHaveBeenCalledWith('✓ No positions with active liquidity found');
      expect(logger.info).toHaveBeenCalledWith('  All positions in your wallet have 0 liquidity');
    });
  });
});
