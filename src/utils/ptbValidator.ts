import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import { logger } from './logger';

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
          const resultIdx = match ? parseInt(match[1]) : undefined;
          const secondaryIdx = match ? parseInt(match[2]) : undefined;
          
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
   * Logs PTB command structure for debugging
   * Use this before build() to inspect command flow
   */
  static logCommandStructure(tx: Transaction, label: string = 'PTB'): void {
    const ptbData = tx.getData();
    logger.info(`=== ${label} COMMAND STRUCTURE ===`);
    logger.info(`Total commands: ${ptbData.commands.length}`);
    
    ptbData.commands.forEach((cmd: any, idx: number) => {
      const kind = cmd.$kind || cmd.kind || 'unknown';
      logger.info(`Command ${idx}: ${kind}`);
      
      // Log relevant details based on command type
      if (kind === 'MoveCall') {
        const target = cmd.target || cmd.MoveCall?.target;
        logger.info(`  Target: ${target}`);
      } else if (kind === 'MergeCoins') {
        logger.info(`  Merging coins`);
      }
    });
    
    logger.info(`=== END ${label} ===`);
  }
}
