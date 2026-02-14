import fs from 'fs';
import path from 'path';
import { RebalanceState, RebalanceStateData } from '../types';
import { logger } from './logger';

/**
 * StateManager handles persistence of rebalance state to enable safe resume after crashes/restarts.
 * Prevents duplicate operations like closing a position twice.
 */
export class StateManager {
  private stateFilePath: string;

  constructor(stateFilePath?: string) {
    // Default to .rebalance-state.json in current directory if not specified
    this.stateFilePath = stateFilePath || path.join(process.cwd(), '.rebalance-state.json');
  }

  /**
   * Load current state from file
   * Returns null if no state file exists (fresh start)
   */
  loadState(): RebalanceStateData | null {
    try {
      if (!fs.existsSync(this.stateFilePath)) {
        logger.info('No state file found - starting fresh');
        return null;
      }

      const content = fs.readFileSync(this.stateFilePath, 'utf-8');
      const state = JSON.parse(content) as RebalanceStateData;

      logger.info(`Loaded state: ${state.state} from ${this.stateFilePath}`);
      logger.info(`  Position ID: ${state.positionId}`);
      logger.info(`  Timestamp: ${state.timestamp}`);

      return state;
    } catch (error) {
      logger.error('Error loading state file', error);
      // If we can't load the state, return null to start fresh
      return null;
    }
  }

  /**
   * Save current state to file
   * Creates or overwrites the state file
   */
  saveState(stateData: RebalanceStateData): void {
    try {
      const content = JSON.stringify(stateData, null, 2);
      fs.writeFileSync(this.stateFilePath, content, 'utf-8');

      logger.info(`State saved: ${stateData.state}`);
    } catch (error) {
      logger.error('Error saving state file', error);
      // Don't throw - we don't want state save failures to break the rebalance
    }
  }

  /**
   * Clear state file (rebalance complete)
   * Returns to MONITORING state
   */
  clearState(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        fs.unlinkSync(this.stateFilePath);
        logger.info('State file cleared - returned to MONITORING');
      }
    } catch (error) {
      logger.error('Error clearing state file', error);
      // Don't throw - we don't want state clear failures to break the flow
    }
  }

  /**
   * Check if a state represents a step that's already been completed
   */
  isStateCompleted(currentState: RebalanceState | null, targetState: RebalanceState): boolean {
    if (!currentState) {
      return false;
    }

    // Define state order
    const stateOrder = [
      RebalanceState.MONITORING,
      RebalanceState.POSITION_CLOSED,
      RebalanceState.SWAP_COMPLETED,
      RebalanceState.POSITION_OPENED,
      RebalanceState.LIQUIDITY_ADDED,
    ];

    const currentIndex = stateOrder.indexOf(currentState);
    const targetIndex = stateOrder.indexOf(targetState);

    // If current state is at or past target state, it's completed
    return currentIndex >= targetIndex;
  }

  /**
   * Get the next state in the sequence
   */
  getNextState(currentState: RebalanceState): RebalanceState {
    switch (currentState) {
      case RebalanceState.MONITORING:
        return RebalanceState.POSITION_CLOSED;
      case RebalanceState.POSITION_CLOSED:
        return RebalanceState.SWAP_COMPLETED;
      case RebalanceState.SWAP_COMPLETED:
        return RebalanceState.POSITION_OPENED;
      case RebalanceState.POSITION_OPENED:
        return RebalanceState.LIQUIDITY_ADDED;
      case RebalanceState.LIQUIDITY_ADDED:
        return RebalanceState.MONITORING;
      default:
        return RebalanceState.MONITORING;
    }
  }
}
