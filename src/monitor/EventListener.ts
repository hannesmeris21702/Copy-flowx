/**
 * Event Listener
 * Monitors blockchain events, specifically large swap events that may require position adjustments
 */

import { SuiClient, SuiEvent } from "@mysten/sui/client";
import BN from "bn.js";
import { getLogger } from "../utils/Logger";

const logger = getLogger(module);

/**
 * Swap event data extracted from blockchain event
 */
export interface SwapEvent {
  poolId: string;
  amountIn: string;
  amountOut: string;
  tokenInType: string;
  tokenOutType: string;
  timestamp: number;
  atob: boolean;
}

/**
 * Event listener callback type
 */
export type SwapEventCallback = (event: SwapEvent) => void;

/**
 * EventListener class
 * Listens to swap events and triggers callbacks for large swaps
 */
export class EventListener {
  private client: SuiClient;
  private poolId: string;
  private largeSwapThreshold: BN;
  private callbacks: SwapEventCallback[] = [];
  private isListening: boolean = false;

  constructor(
    client: SuiClient,
    poolId: string,
    largeSwapThresholdUsd: number
  ) {
    this.client = client;
    this.poolId = poolId;
    this.largeSwapThreshold = new BN(largeSwapThresholdUsd);
    logger.info(
      `EventListener: Initialized for pool ${poolId}, threshold: $${largeSwapThresholdUsd}`
    );
  }

  /**
   * Register a callback for swap events
   * @param callback - Function to call when swap event detected
   */
  onSwapEvent(callback: SwapEventCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Start listening to events
   * Note: This is a simplified implementation
   * Production implementation would use SuiClient.subscribeEvent or event queries
   */
  start(): void {
    if (this.isListening) {
      logger.warn("EventListener: Already listening");
      return;
    }

    this.isListening = true;
    logger.info("EventListener: Started monitoring swap events");

    // TODO: Implement actual event subscription
    // In production, would use:
    // - SuiClient.subscribeEvent for real-time events
    // - Or periodic queryEvents with cursor-based pagination
    // For now, this serves as the interface structure

    // Example implementation would be:
    // this.subscribeToSwapEvents();
  }

  /**
   * Stop listening to events
   */
  stop(): void {
    if (!this.isListening) {
      return;
    }

    this.isListening = false;
    logger.info("EventListener: Stopped monitoring swap events");
  }

  /**
   * Process a swap event and trigger callbacks if threshold exceeded
   * @param event - Swap event from blockchain
   * @param valueUsd - USD value of the swap
   */
  private processSwapEvent(event: SwapEvent, valueUsd: BN): void {
    logger.info(
      `EventListener: Swap event detected - Pool: ${event.poolId}, Value: $${valueUsd.toString()}`
    );

    // Check if swap exceeds threshold
    if (valueUsd.gte(this.largeSwapThreshold)) {
      logger.warn(
        `EventListener: LARGE SWAP detected - Value: $${valueUsd.toString()} >= Threshold: $${this.largeSwapThreshold.toString()}`
      );

      // Trigger all registered callbacks
      for (const callback of this.callbacks) {
        try {
          callback(event);
        } catch (error) {
          logger.error("EventListener: Error in swap event callback", error);
        }
      }
    }
  }

  /**
   * Query recent swap events
   * This can be called periodically to check for large swaps
   */
  async queryRecentSwapEvents(): Promise<void> {
    // TODO: Implement event querying
    // Would use SuiClient.queryEvents with appropriate filters
    // for Cetus swap events on this pool

    logger.debug(
      "EventListener: Querying recent swap events (not yet implemented)"
    );
  }

  /**
   * Get listening status
   */
  isActive(): boolean {
    return this.isListening;
  }

  /**
   * Get configured threshold
   */
  getThreshold(): BN {
    return this.largeSwapThreshold;
  }
}
