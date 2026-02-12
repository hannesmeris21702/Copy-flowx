/**
 * Strategy Configuration Presets
 * Pre-configured strategy modes for different risk profiles
 */

import { BPS, Percent } from "../utils/sdkTypes";
import BN from "bn.js";

/**
 * Strategy mode enum
 */
export enum StrategyMode {
  SAFE = "SAFE",
  AGGRESSIVE = "AGGRESSIVE",
}

/**
 * Full strategy configuration
 */
export interface StrategyConfiguration {
  // Core strategy parameters
  mode: StrategyMode;
  rangePercent: Percent; // Width of price range (% from current price)
  slippageTolerance: Percent; // Max acceptable slippage on trades
  maxPriceImpact: Percent; // Max acceptable price impact
  minLiquidity: BN; // Minimum liquidity threshold
  
  // Risk management
  rebalanceCooldownMs: number; // Min time between rebalances
  maxVolatility: Percent; // Max acceptable volatility
  
  // Event monitoring
  largeSwapThresholdUsd: number; // USD threshold for "large" swaps
  
  // Reward compounding
  rewardThresholdUsd: number; // Min USD value to trigger reward compound
  compoundScheduleMs: number; // Time between scheduled compounds
}

/**
 * SAFE mode configuration
 * Conservative parameters for stable, low-risk operation
 */
export const SAFE_MODE_CONFIG: StrategyConfiguration = {
  mode: StrategyMode.SAFE,
  
  // Wider range for less frequent rebalancing
  rangePercent: new Percent(500, BPS), // 5% range width
  
  // Conservative slippage tolerance
  slippageTolerance: new Percent(100, BPS), // 1% slippage
  
  // Strict price impact limit
  maxPriceImpact: new Percent(-50, BPS), // -0.5% max negative impact
  
  // Higher minimum liquidity
  minLiquidity: new BN(100000), // 100k minimum
  
  // Longer cooldown between rebalances
  rebalanceCooldownMs: 3600000, // 1 hour
  
  // Lower volatility tolerance
  maxVolatility: new Percent(1000, BPS), // 10% max volatility
  
  // Higher threshold for large swaps
  largeSwapThresholdUsd: 100000, // $100k
  
  // Higher reward threshold
  rewardThresholdUsd: 10, // $10 minimum
  
  // Less frequent compounding
  compoundScheduleMs: 86400000, // 24 hours
};

/**
 * AGGRESSIVE mode configuration
 * Active parameters for maximizing yield with higher risk
 */
export const AGGRESSIVE_MODE_CONFIG: StrategyConfiguration = {
  mode: StrategyMode.AGGRESSIVE,
  
  // Tighter range for more capital efficiency
  rangePercent: new Percent(200, BPS), // 2% range width
  
  // Higher slippage tolerance for faster execution
  slippageTolerance: new Percent(500, BPS), // 5% slippage
  
  // Relaxed price impact limit
  maxPriceImpact: new Percent(-500, BPS), // -5% max negative impact
  
  // Lower minimum liquidity
  minLiquidity: new BN(10000), // 10k minimum
  
  // Shorter cooldown for more frequent rebalancing
  rebalanceCooldownMs: 600000, // 10 minutes
  
  // Higher volatility tolerance
  maxVolatility: new Percent(2000, BPS), // 20% max volatility
  
  // Lower threshold for large swaps
  largeSwapThresholdUsd: 50000, // $50k
  
  // Lower reward threshold for more frequent compounding
  rewardThresholdUsd: 1, // $1 minimum
  
  // More frequent compounding
  compoundScheduleMs: 3600000, // 1 hour
};

/**
 * Get configuration for a specific mode
 */
export function getStrategyConfig(mode: StrategyMode): StrategyConfiguration {
  switch (mode) {
    case StrategyMode.SAFE:
      return SAFE_MODE_CONFIG;
    case StrategyMode.AGGRESSIVE:
      return AGGRESSIVE_MODE_CONFIG;
    default:
      return SAFE_MODE_CONFIG; // Default to safe mode
  }
}

/**
 * Create custom configuration by overriding preset
 */
export function createCustomConfig(
  baseMode: StrategyMode,
  overrides: Partial<StrategyConfiguration>
): StrategyConfiguration {
  const baseConfig = getStrategyConfig(baseMode);
  return {
    ...baseConfig,
    ...overrides,
  };
}
