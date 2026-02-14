import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import { logger } from './logger';
import { isDebugMode, debugLog, ifDebug } from './debugMode';

/**
 * PTB Validation Error - Detected before build/execution
 * Provides inline diagnostics for GitHub Copilot /fix suggestions
 */
export class PTBValidationError extends Error {
  constructor(
    message: string,
    public readonly commandIndex?: number,
    public readonly errorType?: 'SecondaryIndexOutOfBounds' | 'InvalidResultIndex' | 'MissingCoin' | 'TypeMismatch',
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'PTBValidationError';
  }
}

/**
 * PTB Command Validator
 * Validates PTB commands before build to catch errors early
 * Integrates with Error Lens for inline diagnostics and Copilot auto-fix
 */
export class PTBValidator {
  /**
   * Validates PTB before build using dry-run
   * @copilot Use this to validate PTB before build(). If validation fails, check:
   * 1. Result index references (e.g., result[3][0])
   * 2. MergeCoins source coin availability
   * 3. Type argument consistency
   * 
   * @param tx Transaction to validate
   * @param client SuiClient for dry-run
   * @param sender Sender address for the transaction
   * @returns True if valid, throws PTBValidationError otherwise
   */
  static async validateBeforeBuild(
    tx: Transaction,
    client: SuiClient,
    sender: string
  ): Promise<boolean> {
    try {
      logger.debug('🔍 PTB Pre-build validation starting...');
      
      // Get PTB data for inspection
      const ptbData = tx.getData();
      logger.debug(`  Commands: ${ptbData.commands.length}`);
      
      // Validate command structure
      this.validateCommandStructure(ptbData);
      
      // Set sender if not already set
      if (!ptbData.sender) {
        tx.setSender(sender);
      }
      
      // Build transaction bytes for dry-run
      const txBytes = await tx.build({ client });
      
      // Run dry-run validation
      logger.debug('  Running dry-run validation...');
      const dryRunResult = await client.dryRunTransactionBlock({
        transactionBlock: txBytes,
      });
      
      // Check dry-run status
      if (dryRunResult.effects.status.status !== 'success') {
        const errorMsg = dryRunResult.effects.status.error || 'Unknown error';
        
        // Parse error type for Copilot suggestions
        if (errorMsg.includes('SecondaryIndexOutOfBounds')) {
          const match = errorMsg.match(/result_idx:(\d+) secondary_idx:(\d+)/);
          const matchGroup1 = match?.[1];
          const matchGroup2 = match?.[2];
          const resultIdx = matchGroup1 !== undefined ? parseInt(matchGroup1) : undefined;
          const secondaryIdx = matchGroup2 !== undefined ? parseInt(matchGroup2) : undefined;
          
          const fixSuggestion = [
            '@copilot Fix: Use conditional mergeCoins pattern.',
            'Check if coin exists before merge:',
            'if (willReturnCoin) { ptb.mergeCoins(destination, [source]); }'
          ].join('\n');
          
          throw new PTBValidationError(
            `SecondaryIndexOutOfBounds: Attempted to access result[${resultIdx}][${secondaryIdx}] but it doesn't exist`,
            resultIdx,
            'SecondaryIndexOutOfBounds',
            fixSuggestion
          );
        }
        
        throw new PTBValidationError(
          `PTB validation failed: ${errorMsg}`,
          undefined,
          'TypeMismatch',
          'Check type arguments and command order'
        );
      }
      
      logger.debug('  ✓ PTB validation passed');
      return true;
      
    } catch (error) {
      if (error instanceof PTBValidationError) {
        throw error;
      }
      
      // Wrap other errors
      throw new PTBValidationError(
        `PTB validation error: ${(error as Error).message}`,
        undefined,
        undefined,
        'Review PTB command structure and arguments'
      );
    }
  }
  
  /**
   * Validates PTB command structure
   * Checks for common issues like result index references
   * 
   * @copilot This helps detect SecondaryIndexOutOfBounds before execution
   */
  private static validateCommandStructure(ptbData: {
    commands?: Array<{
      $kind?: string;
      kind?: string;
      arguments?: any[];
      amounts?: any[];
      [key: string]: any;
    }>;
    [key: string]: any;
  }): void {
    logger.debug('  Validating command structure...');
    
    const commands = ptbData.commands || [];
    const resultCounts: number[] = []; // Track result count per command
    
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      if (!cmd) {
        logger.warn(`Command ${i} is undefined, skipping validation`);
        continue;
      }
      logger.debug(`    Command ${i}: ${cmd.$kind || cmd.kind || 'unknown'}`);
      
      // Track expected result counts
      if (cmd.$kind === 'MoveCall' || cmd.kind === 'MoveCall') {
        // MoveCall can return 0-N results, default to 1 for safety
        resultCounts[i] = 1;
      } else if (cmd.$kind === 'SplitCoins' || cmd.kind === 'SplitCoins') {
        // SplitCoins returns array of coins
        const amounts = cmd.amounts || cmd.SplitCoins?.amounts || [];
        resultCounts[i] = amounts.length;
      } else {
        resultCounts[i] = 1;
      }
      
      // Validate result references in arguments
      // @copilot This catches invalid result[x][y] references early
      this.validateResultReferences(cmd, i, resultCounts);
    }
    
    logger.debug('  ✓ Command structure validation passed');
  }
  
  /**
   * Validates result references in command arguments
   * Detects potential SecondaryIndexOutOfBounds errors
   * 
   * @param cmd Command to validate
   * @param cmdIndex Current command index
   * @param _resultCounts Reserved for future: tracking expected result counts per command
   */
  private static validateResultReferences(
    cmd: any,
    cmdIndex: number,
    _resultCounts: number[]
  ): void {
    // Check if command has arguments that might be result references
    const args = cmd.arguments || cmd.MoveCall?.arguments || cmd.MergeCoins?.sources || [];
    
    for (const arg of args) {
      // Check for NestedResult pattern: { NestedResult: [resultIdx, nestedIdx] }
      if (arg && typeof arg === 'object') {
        if (arg.NestedResult && Array.isArray(arg.NestedResult)) {
          const [resultIdx, nestedIdx] = arg.NestedResult;
          
          // Validate result index exists
          if (resultIdx >= cmdIndex) {
            logger.warn(
              `  ⚠ Potential issue at command ${cmdIndex}: ` +
              `References future result[${resultIdx}][${nestedIdx}]`
            );
          }
          
          // Note: We can't validate nestedIdx without runtime info
          // but we can warn about high indices
          if (nestedIdx > 1) {
            logger.debug(
              `  ℹ Command ${cmdIndex} references result[${resultIdx}][${nestedIdx}] ` +
              `(higher nested index)`
            );
          }
        }
        
        // Check for Result pattern: { Result: resultIdx }
        if (arg.Result !== undefined) {
          const resultIdx = arg.Result;
          if (resultIdx >= cmdIndex) {
            logger.warn(
              `  ⚠ Potential issue at command ${cmdIndex}: ` +
              `References future result[${resultIdx}]`
            );
          }
        }
      }
    }
  }
  
  /**
   * Creates safe conditional merge pattern
   * @copilot Use this pattern to avoid SecondaryIndexOutOfBounds in mergeCoins
   * 
   * Example:
   * ```typescript
   * const merged = PTBValidator.conditionalMerge(
   *   ptb,
   *   stableCoin,
   *   willReturnCoin ? [resultCoin] : [],
   *   'coinA from close_position'
   * );
   * ```
   */
  static conditionalMerge(
    ptb: Transaction,
    destination: any,
    sources: any[],
    description: string
  ): void {
    if (sources.length === 0) {
      logger.debug(`  ⊘ Skipped merge: ${description} (no sources)`);
      return;
    }
    
    ptb.mergeCoins(destination, sources);
    logger.debug(`  ✓ Merged: ${description}`);
  }
  
  /**
   * Log PTB command structure
   * In DEBUG_MODE: Prints full PTB structure with detailed command info
   * In production: Uses minimal logging
   * 
   * @param tx Transaction to log
   * @param label Label for the log output
   */
  static logCommandStructure(tx: Transaction, label: string = 'PTB'): void {
    const ptbData = tx.getData();
    
    if (isDebugMode()) {
      // DEBUG MODE: Full verbose output
      logger.info(`=== ${label} COMMAND STRUCTURE (DEBUG MODE) ===`);
      logger.info(`Total commands: ${ptbData.commands.length}`);
      logger.info(`Inputs: ${ptbData.inputs.length}`);
      
      // Log all commands with full details
      ptbData.commands.forEach((cmd: any, idx: number) => {
        const kind = cmd.$kind || cmd.kind || 'unknown';
        logger.info(`\nCommand ${idx}: ${kind}`);
        
        // Log full command object in debug mode
        debugLog(() => `  Full command data: ${JSON.stringify(cmd, null, 2)}`);
        
        // Log relevant details based on command type
        if (kind === 'MoveCall') {
          const target = cmd.target || cmd.MoveCall?.target;
          const args = cmd.arguments || cmd.MoveCall?.arguments || [];
          const typeArgs = cmd.typeArguments || cmd.MoveCall?.typeArguments || [];
          logger.info(`  Target: ${target}`);
          logger.info(`  Arguments: ${args.length} args`);
          logger.info(`  Type Arguments: ${typeArgs.length} type args`);
          
          // In debug mode, show argument details
          ifDebug(() => {
            args.forEach((arg: any, argIdx: number) => {
              logger.info(`    Arg ${argIdx}: ${JSON.stringify(arg)}`);
            });
          });
        } else if (kind === 'MergeCoins') {
          const destination = cmd.destination || cmd.MergeCoins?.destination;
          const sources = cmd.sources || cmd.MergeCoins?.sources || [];
          logger.info(`  Destination: ${JSON.stringify(destination)}`);
          logger.info(`  Sources: ${sources.length} coins`);
          
          ifDebug(() => {
            sources.forEach((source: any, srcIdx: number) => {
              logger.info(`    Source ${srcIdx}: ${JSON.stringify(source)}`);
            });
          });
        } else if (kind === 'SplitCoins') {
          const coin = cmd.coin || cmd.SplitCoins?.coin;
          const amounts = cmd.amounts || cmd.SplitCoins?.amounts || [];
          logger.info(`  Coin: ${JSON.stringify(coin)}`);
          logger.info(`  Amounts: ${amounts.length} splits`);
        } else if (kind === 'TransferObjects') {
          const objects = cmd.objects || cmd.TransferObjects?.objects || [];
          const address = cmd.address || cmd.TransferObjects?.address;
          logger.info(`  Objects: ${objects.length} objects`);
          logger.info(`  Address: ${JSON.stringify(address)}`);
        }
      });
      
      // Log command index mapping
      logger.info(`\n=== COMMAND INDEX MAPPING ===`);
      ptbData.commands.forEach((cmd: any, idx: number) => {
        const kind = cmd.$kind || cmd.kind || 'unknown';
        logger.info(`  [${idx}] -> ${kind}`);
      });
      
      logger.info(`=== END ${label} (DEBUG) ===\n`);
    } else {
      // PRODUCTION MODE: Minimal logging
      logger.info(`${label}: ${ptbData.commands.length} commands`);
    }
  }
}
