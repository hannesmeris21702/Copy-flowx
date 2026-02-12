import { CetusService } from './cetusService';
import { BotConfig, Pool, Position } from '../types';
import { logger } from '../utils/logger';
import {
  isTickInRange,
  calculatePriceDeviation,
  calculateTickRange,
} from '../utils/tickMath';

export interface MonitorReport {
  timestamp: number;
  pool: Pool;
  position: Position;
  currentTick: number;
  isInRange: boolean;
  priceDeviation: number;
  suggestedNewRange: {
    tickLower: number;
    tickUpper: number;
  };
  shouldRebalance: boolean;
  reason: string;
}

export class MonitorService {
  private cetusService: CetusService;
  private config: BotConfig;
  
  constructor(cetusService: CetusService, config: BotConfig) {
    this.cetusService = cetusService;
    this.config = config;
  }
  
  async generateReport(): Promise<MonitorReport> {
    const [pool, position] = await Promise.all([
      this.cetusService.getPool(),
      this.cetusService.getPosition(),
    ]);
    
    const inRange = isTickInRange(
      pool.currentTick,
      position.tickLower,
      position.tickUpper
    );
    
    const deviation = calculatePriceDeviation(
      pool.currentTick,
      position.tickLower,
      position.tickUpper
    );
    
    const suggestedNewRange = calculateTickRange(
      pool.currentTick,
      this.config.rangeWidthPercent,
      pool.tickSpacing
    );
    
    // Determine if rebalancing should happen
    let shouldRebalance = false;
    let reason = 'Position is in range';
    
    if (!inRange) {
      if (Math.abs(deviation) >= this.config.rebalanceThresholdPercent) {
        shouldRebalance = true;
        reason = `Price moved ${deviation.toFixed(2)}% outside range (threshold: ${this.config.rebalanceThresholdPercent}%)`;
      } else {
        reason = `Price out of range but deviation ${deviation.toFixed(2)}% below threshold ${this.config.rebalanceThresholdPercent}%`;
      }
    }
    
    const report: MonitorReport = {
      timestamp: Date.now(),
      pool,
      position,
      currentTick: pool.currentTick,
      isInRange: inRange,
      priceDeviation: deviation,
      suggestedNewRange,
      shouldRebalance,
      reason,
    };
    
    this.logReport(report);
    
    return report;
  }
  
  private logReport(report: MonitorReport): void {
    logger.info('=== Position Monitor Report ===');
    logger.info(`Pool: ${report.pool.id}`);
    logger.info(`Position: ${report.position.id}`);
    logger.info(`Current Tick: ${report.currentTick}`);
    logger.info(`Position Range: [${report.position.tickLower}, ${report.position.tickUpper}]`);
    logger.info(`In Range: ${report.isInRange ? 'YES' : 'NO'}`);
    
    if (!report.isInRange) {
      logger.warn(`Price Deviation: ${report.priceDeviation.toFixed(2)}%`);
      logger.warn(`Suggested New Range: [${report.suggestedNewRange.tickLower}, ${report.suggestedNewRange.tickUpper}]`);
      
      if (report.shouldRebalance) {
        logger.error(`ALERT: ${report.reason}`);
        logger.error('Rebalancing will be triggered');
      } else {
        logger.warn(`No rebalance: ${report.reason}`);
      }
    } else {
      logger.info('Position is healthy');
    }
    
    logger.info('===============================');
  }
}
