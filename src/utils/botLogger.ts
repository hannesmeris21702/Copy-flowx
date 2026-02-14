import { logger } from './logger';

/**
 * Bot step/stage types for organized logging
 */
export enum BotStep {
  INITIALIZATION = 'INITIALIZATION',
  COLLECT_FEE = 'COLLECT_FEE',
  CLOSE_POSITION = 'CLOSE_POSITION',
  PREPARE_COINS = 'PREPARE_COINS',
  SWAP = 'SWAP',
  OPEN_POSITION = 'OPEN_POSITION',
  ADD_LIQUIDITY = 'ADD_LIQUIDITY',
  TRANSFER = 'TRANSFER',
  VALIDATION = 'VALIDATION',
  EXECUTION = 'EXECUTION'
}

/**
 * PTB command information for structured logging
 */
interface PTBCommandInfo {
  index: number;
  type: string;
  purpose: string;
  stage?: BotStep;
}

/**
 * Current bot step context for grouping related logs
 */
let currentStep: BotStep | null = null;
let stepStartTime: number | null = null;

/**
 * Bot logger for structured logging with step grouping and PTB command tracking
 */
export class BotLogger {
  /**
   * Begin a new bot step/stage
   */
  static beginStep(step: BotStep, description?: string): void {
    currentStep = step;
    stepStartTime = Date.now();
    
    const separator = '='.repeat(70);
    logger.info(separator);
    logger.info(`🤖 BEGIN STEP: ${step}${description ? ` - ${description}` : ''}`);
    logger.info(separator);
  }

  /**
   * End the current bot step
   */
  static endStep(): void {
    if (currentStep && stepStartTime) {
      const duration = Date.now() - stepStartTime;
      const separator = '='.repeat(70);
      logger.info(`✓ END STEP: ${currentStep} (completed in ${duration}ms)`);
      logger.info(separator);
    }
    currentStep = null;
    stepStartTime = null;
  }

  /**
   * Log a message within the current step
   */
  static stepInfo(message: string): void {
    const prefix = currentStep ? `[${currentStep}] ` : '';
    logger.info(`${prefix}${message}`);
  }

  /**
   * Log a warning within the current step
   */
  static stepWarn(message: string): void {
    const prefix = currentStep ? `[${currentStep}] ` : '';
    logger.warn(`${prefix}${message}`);
  }

  /**
   * Log an error within the current step
   */
  static stepError(message: string, error?: Error): void {
    const prefix = currentStep ? `[${currentStep}] ` : '';
    logger.error(`${prefix}${message}`, error);
  }

  /**
   * Log a debug message within the current step
   */
  static stepDebug(message: string): void {
    const prefix = currentStep ? `[${currentStep}] ` : '';
    logger.debug(`${prefix}${message}`);
  }

  /**
   * Log PTB command information with index and purpose
   */
  static logPTBCommand(info: PTBCommandInfo): void {
    const stageLabel = info.stage ? `[${info.stage}] ` : '';
    logger.info(`${stageLabel}Command ${info.index}: ${info.type} - ${info.purpose}`);
  }

  /**
   * Log a group of PTB commands
   */
  static logPTBCommands(commands: PTBCommandInfo[]): void {
    logger.info('=== PTB COMMANDS OVERVIEW ===');
    logger.info(`Total commands: ${commands.length}`);
    
    // Group commands by stage if available
    const byStage = new Map<string, PTBCommandInfo[]>();
    const noStage: PTBCommandInfo[] = [];
    
    commands.forEach(cmd => {
      if (cmd.stage) {
        const stage = cmd.stage.toString();
        if (!byStage.has(stage)) {
          byStage.set(stage, []);
        }
        byStage.get(stage)!.push(cmd);
      } else {
        noStage.push(cmd);
      }
    });
    
    // Log commands grouped by stage
    byStage.forEach((cmds, stage) => {
      logger.info(`\n--- ${stage} ---`);
      cmds.forEach(cmd => {
        logger.info(`  Command ${cmd.index}: ${cmd.type} - ${cmd.purpose}`);
      });
    });
    
    // Log commands without stage
    if (noStage.length > 0) {
      logger.info('\n--- OTHER ---');
      noStage.forEach(cmd => {
        logger.info(`  Command ${cmd.index}: ${cmd.type} - ${cmd.purpose}`);
      });
    }
    
    logger.info('=== END PTB COMMANDS ===');
  }

  /**
   * Log PTB validation with detailed command structure
   */
  static logPTBValidation(ptbData: any): void {
    logger.info('=== PTB COMMANDS PRE-BUILD VALIDATION ===');
    logger.info(`Total commands: ${ptbData.commands.length}`);
    
    ptbData.commands.forEach((cmd: any, idx: number) => {
      const cmdType = cmd.$kind || cmd.kind || 'unknown';
      const cmdStr = JSON.stringify(cmd);
      const truncatedCmd = cmdStr.length > 300 ? cmdStr.substring(0, 300) + '...' : cmdStr;
      logger.info(`Command ${idx}: type=${cmdType}, data=${truncatedCmd}`);
    });
    
    logger.info('=== END PTB COMMANDS ===');
  }

  /**
   * Log swap operation details
   */
  static logSwap(params: {
    direction: 'A_to_B' | 'B_to_A' | 'none';
    reason?: string;
    inputAmount?: string;
    outputAmount?: string;
  }): void {
    const prefix = currentStep ? `[${currentStep}] ` : '';
    
    if (params.direction === 'none') {
      logger.info(`${prefix}⊘ Swap: Not needed${params.reason ? ` - ${params.reason}` : ''}`);
    } else {
      const arrow = params.direction === 'A_to_B' ? '→' : '←';
      logger.info(`${prefix}🔄 Swap: ${params.direction.replace('_', ' ')} ${arrow}`);
      if (params.reason) {
        logger.info(`${prefix}  Reason: ${params.reason}`);
      }
      if (params.inputAmount) {
        logger.info(`${prefix}  Input: ${params.inputAmount}`);
      }
      if (params.outputAmount) {
        logger.info(`${prefix}  Output: ${params.outputAmount}`);
      }
    }
  }

  /**
   * Log position opening
   */
  static logOpenPosition(params: {
    poolId: string;
    tickLower: number;
    tickUpper: number;
    success: boolean;
  }): void {
    const prefix = currentStep ? `[${currentStep}] ` : '';
    const status = params.success ? '✓' : '✗';
    
    logger.info(`${prefix}${status} Open Position:`);
    logger.info(`${prefix}  Pool: ${params.poolId}`);
    logger.info(`${prefix}  Range: [${params.tickLower}, ${params.tickUpper}]`);
  }

  /**
   * Log liquidity addition
   */
  static logAddLiquidity(params: {
    positionId: string;
    amountA: string;
    amountB: string;
    success: boolean;
  }): void {
    const prefix = currentStep ? `[${currentStep}] ` : '';
    const status = params.success ? '✓' : '✗';
    
    logger.info(`${prefix}${status} Add Liquidity:`);
    logger.info(`${prefix}  Position: ${params.positionId}`);
    logger.info(`${prefix}  Amount A: ${params.amountA}`);
    logger.info(`${prefix}  Amount B: ${params.amountB}`);
  }

  /**
   * Log flow summary
   */
  static logFlowSummary(flow: string[]): void {
    logger.info('=== TRANSACTION FLOW SUMMARY ===');
    logger.info(`Flow: ${flow.join(' → ')}`);
    logger.info('=== END FLOW SUMMARY ===');
  }
}

// Export convenience functions
export const beginStep = BotLogger.beginStep.bind(BotLogger);
export const endStep = BotLogger.endStep.bind(BotLogger);
export const stepInfo = BotLogger.stepInfo.bind(BotLogger);
export const stepWarn = BotLogger.stepWarn.bind(BotLogger);
export const stepError = BotLogger.stepError.bind(BotLogger);
export const stepDebug = BotLogger.stepDebug.bind(BotLogger);
export const logPTBCommand = BotLogger.logPTBCommand.bind(BotLogger);
export const logPTBCommands = BotLogger.logPTBCommands.bind(BotLogger);
export const logPTBValidation = BotLogger.logPTBValidation.bind(BotLogger);
export const logSwap = BotLogger.logSwap.bind(BotLogger);
export const logOpenPosition = BotLogger.logOpenPosition.bind(BotLogger);
export const logAddLiquidity = BotLogger.logAddLiquidity.bind(BotLogger);
export const logFlowSummary = BotLogger.logFlowSummary.bind(BotLogger);
