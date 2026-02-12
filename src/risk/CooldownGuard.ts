/**
 * Cooldown Guard
 * Enforces minimum time between rebalancing operations to prevent over-trading
 */

import { getLogger } from "../utils/Logger";

const logger = getLogger(module);

/**
 * Cooldown check result
 */
export interface CooldownCheckResult {
  allowed: boolean;
  timeSinceLastMs: number;
  cooldownMs: number;
  remainingMs?: number;
  reason?: string;
}

/**
 * CooldownGuard class
 * Enforces cooldown periods between operations
 */
export class CooldownGuard {
  private cooldownMs: number;
  private lastExecutionTime: number = 0;

  constructor(cooldownMs: number) {
    this.cooldownMs = cooldownMs;
    logger.info(
      `CooldownGuard: Initialized with cooldown ${cooldownMs}ms (${Math.floor(cooldownMs / 1000)}s)`
    );
  }

  /**
   * Check if operation is allowed (cooldown period has passed)
   * 
   * @returns Cooldown check result
   */
  checkCooldown(): CooldownCheckResult {
    const now = Date.now();
    const timeSinceLastMs = now - this.lastExecutionTime;

    logger.info(
      `CooldownGuard: Checking cooldown - ` +
        `Time since last: ${Math.floor(timeSinceLastMs / 1000)}s, ` +
        `Required: ${Math.floor(this.cooldownMs / 1000)}s`
    );

    // First execution is always allowed
    if (this.lastExecutionTime === 0) {
      logger.info("CooldownGuard: ALLOWED - First execution");
      return {
        allowed: true,
        timeSinceLastMs,
        cooldownMs: this.cooldownMs,
      };
    }

    // Check if cooldown period has passed
    if (timeSinceLastMs >= this.cooldownMs) {
      logger.info("CooldownGuard: ALLOWED - Cooldown period passed");
      return {
        allowed: true,
        timeSinceLastMs,
        cooldownMs: this.cooldownMs,
      };
    }

    // Cooldown still active
    const remainingMs = this.cooldownMs - timeSinceLastMs;
    logger.warn(
      `CooldownGuard: BLOCKED - Cooldown active, remaining: ${Math.floor(remainingMs / 1000)}s`
    );

    return {
      allowed: false,
      timeSinceLastMs,
      cooldownMs: this.cooldownMs,
      remainingMs,
      reason: `Cooldown period active (${Math.floor(remainingMs / 1000)}s remaining)`,
    };
  }

  /**
   * Record that an operation was executed
   * Resets the cooldown timer
   */
  recordExecution(): void {
    this.lastExecutionTime = Date.now();
    logger.info(
      `CooldownGuard: Execution recorded at ${new Date(this.lastExecutionTime).toISOString()}`
    );
  }

  /**
   * Reset the cooldown timer
   * Allows next operation immediately
   */
  reset(): void {
    this.lastExecutionTime = 0;
    logger.info("CooldownGuard: Cooldown reset");
  }

  /**
   * Get cooldown period in milliseconds
   */
  getCooldownMs(): number {
    return this.cooldownMs;
  }

  /**
   * Update cooldown period
   */
  setCooldownMs(cooldownMs: number): void {
    this.cooldownMs = cooldownMs;
    logger.info(
      `CooldownGuard: Cooldown updated to ${cooldownMs}ms (${Math.floor(cooldownMs / 1000)}s)`
    );
  }

  /**
   * Get time since last execution
   */
  getTimeSinceLastMs(): number {
    if (this.lastExecutionTime === 0) {
      return -1;
    }
    return Date.now() - this.lastExecutionTime;
  }

  /**
   * Get remaining cooldown time
   */
  getRemainingMs(): number {
    const timeSinceLastMs = this.getTimeSinceLastMs();
    if (timeSinceLastMs === -1) {
      return 0; // No cooldown active
    }
    const remaining = this.cooldownMs - timeSinceLastMs;
    return remaining > 0 ? remaining : 0;
  }
}
