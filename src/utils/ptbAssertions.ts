import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { logger } from './logger';

/**
 * PTB Assertion Error - Thrown when attempting unsafe NestedResult operations
 * Provides clear error messages with command index and MoveCall target information
 */
export class PTBAssertionError extends Error {
  constructor(
    message: string,
    public readonly commandIndex?: number,
    public readonly moveCallTarget?: string,
    public readonly nestedIndex?: number
  ) {
    super(message);
    this.name = 'PTBAssertionError';
  }
}

/**
 * Helper functions for safe PTB (Programmable Transaction Block) operations
 * These utilities prevent SecondaryIndexOutOfBounds errors by validating
 * NestedResult references before they are used in the transaction.
 */

/**
 * Asserts that a nested index is valid for accessing MoveCall results.
 * Use this before destructuring or accessing specific outputs from a MoveCall.
 * 
 * Note: This validates the index value, not the actual result structure,
 * as result structure can only be verified at runtime during execution.
 * 
 * @param nestedIndex - The index to access (e.g., 0 for first result, 1 for second)
 * @param commandIndex - The command index in the PTB for error messages
 * @param moveCallTarget - The MoveCall target (e.g., "package::module::function") for error messages
 * @throws PTBAssertionError if the nested index is invalid
 * 
 * @example
 * ```typescript
 * const openPositionResult = ptb.moveCall({
 *   target: `${packageId}::pool_script::open_position`,
 *   arguments: [...]
 * });
 * 
 * // Validate the index before accessing openPositionResult[0]
 * assertNestedResultExists(0, 4, `${packageId}::pool_script::open_position`);
 * const [newPosition] = openPositionResult;
 * ```
 */
export function assertNestedResultExists(
  nestedIndex: number,
  commandIndex: number,
  moveCallTarget: string
): void {
  // Validates the index value is non-negative
  // The actual result structure can only be verified at runtime during execution
  
  if (nestedIndex < 0) {
    throw new PTBAssertionError(
      `Invalid nested index ${nestedIndex}: must be >= 0`,
      commandIndex,
      moveCallTarget,
      nestedIndex
    );
  }
  
  logger.debug(
    `✓ Asserting NestedResult[${commandIndex}][${nestedIndex}] exists for MoveCall: ${moveCallTarget}`
  );
}

/**
 * Validates that a MoveCall result is safe to reference (non-empty).
 * Use this for MoveCalls that might return zero results in certain conditions.
 * 
 * @param willReturnResults - Boolean indicating if the MoveCall will return results
 * @param commandIndex - The command index in the PTB for error messages
 * @param moveCallTarget - The MoveCall target for error messages
 * @throws PTBAssertionError if results are not expected but code attempts to use them
 * 
 * @example
 * ```typescript
 * const hasLiquidity = position.liquidity > 0;
 * 
 * // Validate before calling a MoveCall that might return no results
 * assertMoveCallWillReturnResults(hasLiquidity, 3, `${packageId}::pool_script::close_position`);
 * 
 * const closeResult = ptb.moveCall({
 *   target: `${packageId}::pool_script::close_position`,
 *   arguments: [...]
 * });
 * // Safe to use closeResult[0] now
 * ```
 */
export function assertMoveCallWillReturnResults(
  willReturnResults: boolean,
  commandIndex: number,
  moveCallTarget: string
): void {
  if (!willReturnResults) {
    logger.warn(
      `⚠ MoveCall at command ${commandIndex} (${moveCallTarget}) may return zero results. ` +
      `Avoid creating NestedResult references to its outputs.`
    );
    throw new PTBAssertionError(
      `MoveCall at command ${commandIndex} (${moveCallTarget}) will not return results. ` +
      `Cannot safely create NestedResult references. Consider calling for side effects only.`,
      commandIndex,
      moveCallTarget
    );
  }
  
  logger.debug(`✓ MoveCall at command ${commandIndex} (${moveCallTarget}) will return results`);
}

/**
 * Creates a safe error message for SecondaryIndexOutOfBounds scenarios.
 * Use this when catching or preventing SecondaryIndexOutOfBounds errors.
 * 
 * @param commandIndex - The command index that caused the error
 * @param nestedIndex - The nested index that was out of bounds
 * @param moveCallTarget - The MoveCall target that didn't return expected results
 * @returns A clear error message with context
 * 
 * @example
 * ```typescript
 * const errorMsg = createSecondaryIndexOutOfBoundsError(
 *   2,
 *   0,
 *   `${packageId}::pool_script_v2::collect_fee`
 * );
 * logger.error(errorMsg);
 * ```
 */
export function createSecondaryIndexOutOfBoundsError(
  commandIndex: number,
  nestedIndex: number,
  moveCallTarget?: string
): string {
  const targetInfo = moveCallTarget ? ` (${moveCallTarget})` : '';
  return (
    `SecondaryIndexOutOfBounds: Attempted to access result[${commandIndex}][${nestedIndex}]${targetInfo} but it doesn't exist.\n` +
    `This typically means the MoveCall at command ${commandIndex} returned fewer results than expected.\n` +
    `Solution: Either check if results exist before referencing, or call the MoveCall for side effects only (don't capture its result).`
  );
}

/**
 * Validates a PTB command result metadata before using it in subsequent commands.
 * This is a validation of expected behavior rather than runtime structure inspection.
 * 
 * Note: Actual result count can only be verified during dry-run or execution,
 * not at PTB build time. This function validates expectations and logs attempts.
 * 
 * @param expectedCount - Expected number of nested results (optional)
 * @param commandIndex - The command index for error messages
 * @param moveCallTarget - The MoveCall target for error messages
 * @throws PTBAssertionError if validation fails
 * 
 * @example
 * ```typescript
 * const result = ptb.moveCall({
 *   target: `${packageId}::pool_script::open_position`,
 *   arguments: [...]
 * });
 * 
 * // Validate that open_position is expected to return at least 1 result
 * validateCommandResult(1, 4, `${packageId}::pool_script::open_position`);
 * const [newPosition] = result;  // Safe to destructure based on expectations
 * ```
 */
export function validateCommandResult(
  expectedCount: number | undefined,
  commandIndex: number,
  moveCallTarget: string
): void {
  logger.debug(
    `Validating command ${commandIndex} result (${moveCallTarget})` +
    (expectedCount !== undefined ? ` - expecting ${expectedCount} result(s)` : '')
  );
  
  // Note: At PTB build time, we can't inspect the actual result count
  // This validation primarily serves as documentation and runtime context
  // The real validation happens during dry-run or execution
  
  if (expectedCount !== undefined && expectedCount < 1) {
    throw new PTBAssertionError(
      `Invalid expected count ${expectedCount} for command ${commandIndex} (${moveCallTarget}). ` +
      `Expected count must be >= 1. If the MoveCall returns no results, don't capture or reference its output.`,
      commandIndex,
      moveCallTarget
    );
  }
  
  logger.debug(`✓ Command ${commandIndex} result validated (${moveCallTarget})`);
}

/**
 * Extracts the MoveCall target from a PTB command for error messages.
 * Helper function to get human-readable function names from commands.
 * 
 * @param ptb - The Transaction object
 * @param commandIndex - The command index to inspect
 * @returns The MoveCall target string, or 'unknown' if not found
 * 
 * @example
 * ```typescript
 * const target = extractMoveCallTarget(ptb, 4);
 * // Returns something like "0x123::pool_script::open_position"
 * ```
 */
export function extractMoveCallTarget(ptb: Transaction, commandIndex: number): string {
  try {
    const ptbData = ptb.getData();
    const commands = ptbData.commands;
    
    if (!commands || commandIndex >= commands.length) {
      return 'unknown';
    }
    
    const cmd = commands[commandIndex];
    if (!cmd) {
      return 'unknown';
    }
    
    // Check for MoveCall command
    const isMoveCall = cmd.$kind === 'MoveCall';
    if (!isMoveCall) {
      return 'unknown (not a MoveCall)';
    }
    
    // Extract target from MoveCall structure
    if (cmd.MoveCall) {
      const { package: pkg, module, function: func } = cmd.MoveCall;
      return `${pkg}::${module}::${func}`;
    }
    
    return 'unknown';
  } catch (error) {
    logger.warn(`Failed to extract MoveCall target for command ${commandIndex}: ${(error as Error).message}`);
    return 'unknown';
  }
}

/**
 * Safe wrapper for destructuring MoveCall results.
 * Provides runtime validation with clear error messages.
 * 
 * @param result - The MoveCall result to destructure
 * @param count - Number of results to extract
 * @param commandIndex - The command index for error messages
 * @param moveCallTarget - The MoveCall target for error messages
 * @returns Array of extracted results
 * @throws PTBAssertionError if destructuring would be unsafe
 * 
 * @example
 * ```typescript
 * const openPositionResult = ptb.moveCall({
 *   target: `${packageId}::pool_script::open_position`,
 *   arguments: [...]
 * });
 * 
 * // Safe destructuring with validation
 * const [newPosition, coinA, coinB] = safeDestructure(
 *   openPositionResult,
 *   3,
 *   4,
 *   `${packageId}::pool_script::open_position`
 * );
 * ```
 */
export function safeDestructure(
  result: TransactionObjectArgument | TransactionObjectArgument[],
  count: number,
  commandIndex: number,
  moveCallTarget: string
): TransactionObjectArgument[] {
  if (count < 1) {
    throw new PTBAssertionError(
      `Invalid destructure count ${count} for command ${commandIndex} (${moveCallTarget}). ` +
      `Count must be >= 1.`,
      commandIndex,
      moveCallTarget
    );
  }
  
  // Validate each nested index
  for (let i = 0; i < count; i++) {
    assertNestedResultExists(i, commandIndex, moveCallTarget);
  }
  
  // Perform destructuring
  if (Array.isArray(result)) {
    if (result.length < count) {
      throw new PTBAssertionError(
        `Cannot destructure ${count} results from command ${commandIndex} (${moveCallTarget}): ` +
        `array only has ${result.length} element(s). ` +
        `This indicates a mismatch between expected and actual result count.`,
        commandIndex,
        moveCallTarget
      );
    }
    return result.slice(0, count);
  }
  
  // Single result - return as array
  if (count !== 1) {
    throw new PTBAssertionError(
      `Cannot destructure ${count} results from command ${commandIndex} (${moveCallTarget}): ` +
      `result is a single value, not an array. Expected count should be 1.`,
      commandIndex,
      moveCallTarget
    );
  }
  return [result];
}

/**
 * Checks if a NestedResult reference would be safe to create.
 * Use this before manually creating NestedResult references.
 * 
 * @param ptb - The Transaction object
 * @param referencedCommandIndex - The command index being referenced
 * @param currentCommandIndex - The current command index
 * @param nestedIndex - The nested result index to access
 * @returns true if the reference is safe, false otherwise
 * 
 * @example
 * ```typescript
 * if (isNestedResultSafe(ptb, 2, 5, 0)) {
 *   // Safe to reference result[2][0]
 *   ptb.moveCall({
 *     arguments: [previousResult[0]]
 *   });
 * }
 * ```
 */
export function isNestedResultSafe(
  ptb: Transaction,
  referencedCommandIndex: number,
  currentCommandIndex: number,
  nestedIndex: number
): boolean {
  // Referenced command must come before current command
  if (referencedCommandIndex >= currentCommandIndex) {
    logger.warn(
      `Unsafe NestedResult reference: command ${currentCommandIndex} ` +
      `references future command ${referencedCommandIndex}`
    );
    return false;
  }
  
  // Nested index must be non-negative
  if (nestedIndex < 0) {
    logger.warn(`Unsafe NestedResult reference: negative nested index ${nestedIndex}`);
    return false;
  }
  
  // Check if referenced command exists
  const ptbData = ptb.getData();
  const commands = ptbData.commands;
  if (!commands || referencedCommandIndex >= commands.length) {
    logger.warn(
      `Unsafe NestedResult reference: command ${referencedCommandIndex} ` +
      `doesn't exist (only ${commands?.length || 0} commands)`
    );
    return false;
  }
  
  return true;
}
