import { logger } from './logger';
import { isDebugMode, debugLog } from './debugMode';

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
 * PTB data structure for validation logging
 */
interface PTBData {
  commands: Array<{
    $kind?: string;
    kind?: string;
    [key: string]: any;
  }>;
  [key: string]: any;
}

/**
 * Swap direction enum for type safety
 */
export enum SwapDirection {
  A_TO_B = 'A_to_B',
  B_TO_A = 'B_to_A',
  NONE = 'none'
}

/**
 * Bot step context for managing step state in a thread-safe manner
 */
class BotStepContext {
  private step: BotStep | null = null;
  private startTime: number | null = null;

  setStep(step: BotStep): void {
    this.step = step;
    this.startTime = Date.now();
  }

  clearStep(): void {
    this.step = null;
    this.startTime = null;
  }

  getStep(): BotStep | null {
    return this.step;
  }

  getStartTime(): number | null {
    return this.startTime;
  }

  getDuration(): number | null {
    if (this.startTime === null) return null;
    return Date.now() - this.startTime;
  }
}

/**
 * Current bot step context - isolated per operation
 * Note: For true concurrency support, consider using AsyncLocalStorage
 */
const context = new BotStepContext();

/**
 * Bot logger for structured logging with step grouping and PTB command tracking
 */
export class BotLogger {
  /**
   * Begin a new bot step/stage
   */
  static beginStep(step: BotStep, description?: string): void {
    context.setStep(step);
    
    const separator = '='.repeat(70);
    logger.info(separator);
    logger.info(`🤖 BEGIN STEP: ${step}${description ? ` - ${description}` : ''}`);
    logger.info(separator);
  }

  /**
   * End the current bot step
   */
  static endStep(): void {
    const currentStep = context.getStep();
    const duration = context.getDuration();
    
    if (currentStep && duration !== null) {
      const separator = '='.repeat(70);
      logger.info(`✓ END STEP: ${currentStep} (completed in ${duration}ms)`);
      logger.info(separator);
    }
    
    context.clearStep();
  }

  /**
   * Log a message within the current step
   */
  static stepInfo(message: string): void {
    const currentStep = context.getStep();
    const prefix = currentStep ? `[${currentStep}] ` : '';
    logger.info(`${prefix}${message}`);
  }

  /**
   * Log a warning within the current step
   */
  static stepWarn(message: string): void {
    const currentStep = context.getStep();
    const prefix = currentStep ? `[${currentStep}] ` : '';
    logger.warn(`${prefix}${message}`);
  }

  /**
   * Log an error within the current step
   */
  static stepError(message: string, error?: Error): void {
    const currentStep = context.getStep();
    const prefix = currentStep ? `[${currentStep}] ` : '';
    logger.error(`${prefix}${message}`, error);
  }

  /**
   * Log a debug message within the current step
   */
  static stepDebug(message: string): void {
    const currentStep = context.getStep();
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
   * In DEBUG_MODE: Prints full command details and data
   * In production: Prints minimal command summary
   */
  static logPTBValidation(ptbData: PTBData): void {
    if (isDebugMode()) {
      // DEBUG MODE: Full verbose output
      logger.info('=== PTB COMMANDS PRE-BUILD VALIDATION (DEBUG MODE) ===');
      logger.info(`Total commands: ${ptbData.commands.length}`);
      
      ptbData.commands.forEach((cmd, idx) => {
        const cmdType = cmd.$kind || cmd.kind || 'unknown';
        
        // Full command data in debug mode
        logger.info(`\nCommand ${idx}: type=${cmdType}`);
        debugLog(() => {
          const cmdStr = JSON.stringify(cmd, null, 2);
          return `Full command data:\n${cmdStr}`;
        });
        
        // Show truncated preview in main log
        const cmdStr = JSON.stringify(cmd);
        const truncatedCmd = cmdStr.length > 200 ? cmdStr.substring(0, 200) + '...' : cmdStr;
        logger.info(`  Data: ${truncatedCmd}`);
      });
      
      logger.info('\n=== END PTB COMMANDS (DEBUG) ===');
    } else {
      // PRODUCTION MODE: Minimal logging
      logger.info(`PTB validation: ${ptbData.commands.length} commands ready`);
    }
  }

  /**
   * Log out-of-range detection
   */
  static logOutOfRangeDetection(params: {
    currentTick: number;
    tickLower: number;
    tickUpper: number;
    positionId: string;
    liquidity: string;
  }): void {
    const currentStep = context.getStep();
    const prefix = currentStep ? `[${currentStep}] ` : '';
    
    logger.info(`${prefix}⚠️  OUT_OF_RANGE_DETECTED`);
    logger.info(`${prefix}  Position: ${params.positionId}`);
    logger.info(`${prefix}  Current Tick: ${params.currentTick}`);
    logger.info(`${prefix}  Range: [${params.tickLower}, ${params.tickUpper}]`);
    logger.info(`${prefix}  Liquidity: ${params.liquidity}`);
    logger.info(`${prefix}  Status: ${params.currentTick < params.tickLower ? 'BELOW RANGE' : 'ABOVE RANGE'}`);
  }

  /**
   * Log position closure
   */
  static logPositionClosed(params: {
    positionId: string;
    poolId: string;
    success: boolean;
    transactionDigest?: string;
  }): void {
    const currentStep = context.getStep();
    const prefix = currentStep ? `[${currentStep}] ` : '';
    const status = params.success ? '✅' : '❌';
    
    logger.info(`${prefix}${status} POSITION_CLOSED`);
    logger.info(`${prefix}  Position: ${params.positionId}`);
    logger.info(`${prefix}  Pool: ${params.poolId}`);
    if (params.transactionDigest) {
      logger.info(`${prefix}  Transaction: ${params.transactionDigest}`);
    }
    logger.info(`${prefix}  Liquidity: 100% removed`);
    logger.info(`${prefix}  Fees: Collected`);
    logger.info(`${prefix}  NFT: Closed`);
  }

  /**
   * Log wallet balances
   */
  static logWalletBalances(params: {
    tokenA: {
      type: string;
      balance: string;
    };
    tokenB: {
      type: string;
      balance: string;
    };
    context?: string;
  }): void {
    const currentStep = context.getStep();
    const prefix = currentStep ? `[${currentStep}] ` : '';
    const contextLabel = params.context ? ` (${params.context})` : '';
    
    logger.info(`${prefix}💰 WALLET_BALANCES${contextLabel}`);
    logger.info(`${prefix}  Token A: ${params.tokenA.balance}`);
    logger.info(`${prefix}    Type: ${params.tokenA.type}`);
    logger.info(`${prefix}  Token B: ${params.tokenB.balance}`);
    logger.info(`${prefix}    Type: ${params.tokenB.type}`);
  }

  /**
   * Log swap operation details
   */
  static logSwap(params: {
    direction: SwapDirection;
    reason?: string;
    inputAmount?: string;
    outputAmount?: string;
    price?: string;
    slippage?: string;
    transactionDigest?: string;
  }): void {
    const currentStep = context.getStep();
    const prefix = currentStep ? `[${currentStep}] ` : '';
    
    if (params.direction === SwapDirection.NONE) {
      logger.info(`${prefix}⊘ SWAP_NOT_REQUIRED${params.reason ? ` - ${params.reason}` : ''}`);
    } else {
      const arrow = params.direction === SwapDirection.A_TO_B ? '→' : '←';
      logger.info(`${prefix}🔄 SWAP_EXECUTED: ${params.direction.replace('_', ' ')} ${arrow}`);
      if (params.reason) {
        logger.info(`${prefix}  Reason: ${params.reason}`);
      }
      if (params.inputAmount) {
        logger.info(`${prefix}  Input Amount: ${params.inputAmount}`);
      }
      if (params.outputAmount) {
        logger.info(`${prefix}  Output Amount: ${params.outputAmount}`);
      }
      if (params.price) {
        logger.info(`${prefix}  Price: ${params.price}`);
      }
      if (params.slippage) {
        logger.info(`${prefix}  Slippage: ${params.slippage}%`);
      }
      if (params.transactionDigest) {
        logger.info(`${prefix}  Transaction: ${params.transactionDigest}`);
      }
    }
  }

  /**
   * Log position opening
   */
  static logOpenPosition(params: {
    poolId: string;
    positionId?: string;
    tickLower: number;
    tickUpper: number;
    success: boolean;
    transactionDigest?: string;
  }): void {
    const currentStep = context.getStep();
    const prefix = currentStep ? `[${currentStep}] ` : '';
    const status = params.success ? '✅' : '❌';
    
    logger.info(`${prefix}${status} POSITION_OPENED`);
    if (params.positionId) {
      logger.info(`${prefix}  Position ID: ${params.positionId}`);
    }
    logger.info(`${prefix}  Pool: ${params.poolId}`);
    logger.info(`${prefix}  Range: [${params.tickLower}, ${params.tickUpper}]`);
    if (params.transactionDigest) {
      logger.info(`${prefix}  Transaction: ${params.transactionDigest}`);
    }
  }

  /**
   * Log liquidity addition
   */
  static logAddLiquidity(params: {
    positionId: string;
    amountA: string;
    amountB: string;
    success: boolean;
    transactionDigest?: string;
  }): void {
    const currentStep = context.getStep();
    const prefix = currentStep ? `[${currentStep}] ` : '';
    const status = params.success ? '✅' : '❌';
    
    logger.info(`${prefix}${status} LIQUIDITY_ADDED`);
    logger.info(`${prefix}  Position: ${params.positionId}`);
    logger.info(`${prefix}  Amount A: ${params.amountA}`);
    logger.info(`${prefix}  Amount B: ${params.amountB}`);
    if (params.transactionDigest) {
      logger.info(`${prefix}  Transaction: ${params.transactionDigest}`);
    }
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
export const logOutOfRangeDetection = BotLogger.logOutOfRangeDetection.bind(BotLogger);
export const logPositionClosed = BotLogger.logPositionClosed.bind(BotLogger);
export const logWalletBalances = BotLogger.logWalletBalances.bind(BotLogger);
export const logSwap = BotLogger.logSwap.bind(BotLogger);
export const logOpenPosition = BotLogger.logOpenPosition.bind(BotLogger);
export const logAddLiquidity = BotLogger.logAddLiquidity.bind(BotLogger);
export const logFlowSummary = BotLogger.logFlowSummary.bind(BotLogger);
