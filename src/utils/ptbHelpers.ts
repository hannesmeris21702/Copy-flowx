import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { logger } from './logger';

/**
 * Type representing a PTB result that can be accessed by index.
 * This includes MoveCall results which may have indexed properties.
 */
type IndexableResult = {
  [key: number]: TransactionObjectArgument | undefined;
  [key: string]: unknown;
};

/**
 * Safe PTB Helper Error - Thrown when PTB operations cannot be safely performed
 * Provides clear error messages with context about what went wrong
 */
export class PTBHelperError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly context?: string
  ) {
    super(message);
    this.name = 'PTBHelperError';
  }
}

/**
 * Safely merges coins without directly indexing result arrays.
 * Validates that the source coin exists before attempting to merge.
 * 
 * Rules:
 * - Never index result[x][0] directly
 * - Check existence before use
 * - Throw descriptive error if missing when required
 * 
 * @param ptb - The Transaction builder
 * @param destination - The destination coin to merge into
 * @param source - The source coin to merge from (may be undefined/null/array)
 * @param options - Optional configuration
 * @param options.required - If true, throw error when source is missing (default: false)
 * @param options.description - Description of the merge operation for error messages
 * @throws PTBHelperError if source is required but missing
 * 
 * @example
 * ```typescript
 * // Optional merge - skips if source doesn't exist
 * safeMergeCoins(ptb, destinationCoin, sourceCoin, {
 *   description: 'swap output into main coin'
 * });
 * 
 * // Required merge - throws if source doesn't exist
 * safeMergeCoins(ptb, destinationCoin, sourceCoin, {
 *   required: true,
 *   description: 'critical liquidity merge'
 * });
 * ```
 */
export function safeMergeCoins(
  ptb: Transaction,
  destination: TransactionObjectArgument,
  source: TransactionObjectArgument | TransactionObjectArgument[] | undefined | null,
  options?: {
    required?: boolean;
    description?: string;
  }
): void {
  const description = options?.description || 'coin merge';
  const required = options?.required || false;

  // Handle undefined/null source
  if (source === undefined || source === null) {
    if (required) {
      throw new PTBHelperError(
        `Cannot merge coins: source is ${source === null ? 'null' : 'undefined'}`,
        'safeMergeCoins',
        description
      );
    }
    logger.debug(`Skipping ${description}: source coin is ${source === null ? 'null' : 'undefined'}`);
    return;
  }

  // Handle array source - never index directly, check first
  if (Array.isArray(source)) {
    // Check if array has at least one element
    if (source.length === 0) {
      if (required) {
        throw new PTBHelperError(
          `Cannot merge coins: source array is empty`,
          'safeMergeCoins',
          description
        );
      }
      logger.debug(`Skipping ${description}: source array is empty`);
      return;
    }

    // Extract first element safely
    const firstCoin = source[0];
    if (!firstCoin) {
      if (required) {
        throw new PTBHelperError(
          `Cannot merge coins: first element of source array is undefined`,
          'safeMergeCoins',
          description
        );
      }
      logger.debug(`Skipping ${description}: first element is undefined`);
      return;
    }

    // Perform the merge with the validated coin
    ptb.mergeCoins(destination, [firstCoin]);
    logger.debug(`✓ Merged coin for ${description}`);
    return;
  }

  // Single source coin - merge directly
  ptb.mergeCoins(destination, [source]);
  logger.debug(`✓ Merged coin for ${description}`);
}


/**
 * Safely transfers objects without directly indexing result arrays.
 * Validates that objects exist before attempting to transfer.
 * 
 * Rules:
 * - Never index result[x][0] directly
 * - Check existence before use
 * - Throw descriptive error if missing when required
 * 
 * @param ptb - The Transaction builder
 * @param objects - The objects to transfer (can be single, array, or MoveCall result)
 * @param recipient - The recipient address to transfer to
 * @param options - Optional configuration
 * @param options.required - If true, throw error when objects are missing (default: false)
 * @param options.description - Description of the transfer operation for error messages
 * @throws PTBHelperError if objects are required but missing
 * 
 * @example
 * ```typescript
 * // Optional transfer - skips if object doesn't exist
 * safeTransferObjects(ptb, positionNFT, recipientAddress, {
 *   description: 'position NFT transfer'
 * });
 * 
 * // Required transfer - throws if object doesn't exist
 * safeTransferObjects(ptb, criticalObject, recipientAddress, {
 *   required: true,
 *   description: 'critical asset transfer'
 * });
 * 
 * // Handle MoveCall result safely
 * const result = ptb.moveCall({ ... });
 * safeTransferObjects(ptb, result, recipientAddress, {
 *   description: 'transfer first result from moveCall'
 * });
 * ```
 */
export function safeTransferObjects(
  ptb: Transaction,
  objects: TransactionObjectArgument | TransactionObjectArgument[] | unknown,
  recipient: TransactionObjectArgument,
  options?: {
    required?: boolean;
    description?: string;
  }
): void {
  const description = options?.description || 'object transfer';
  const required = options?.required || false;

  // Handle undefined/null objects
  if (objects === undefined || objects === null) {
    if (required) {
      throw new PTBHelperError(
        `Cannot transfer objects: objects are ${objects === null ? 'null' : 'undefined'}`,
        'safeTransferObjects',
        description
      );
    }
    logger.debug(`Skipping ${description}: objects are ${objects === null ? 'null' : 'undefined'}`);
    return;
  }

  // Handle array - never index directly, check first
  if (Array.isArray(objects)) {
    // Check if array has at least one element
    if (objects.length === 0) {
      if (required) {
        throw new PTBHelperError(
          `Cannot transfer objects: array is empty`,
          'safeTransferObjects',
          description
        );
      }
      logger.debug(`Skipping ${description}: array is empty`);
      return;
    }

    // Extract first element safely
    const firstObject = objects[0];
    if (!firstObject) {
      if (required) {
        throw new PTBHelperError(
          `Cannot transfer objects: first element of array is undefined`,
          'safeTransferObjects',
          description
        );
      }
      logger.debug(`Skipping ${description}: first element is undefined`);
      return;
    }

    // Perform the transfer with the validated object
    ptb.transferObjects([firstObject], recipient);
    logger.debug(`✓ Transferred object for ${description}`);
    return;
  }

  // Check if it's an object-like result (e.g., from moveCall) with indexed access
  // This handles the case where result might have a [0] property
  if (typeof objects === 'object' && objects !== null) {
    // Try to access index 0 safely
    const firstObject = (objects as IndexableResult)[0];
    if (firstObject !== undefined) {
      // Has a [0] property, transfer it
      ptb.transferObjects([firstObject], recipient);
      logger.debug(`✓ Transferred object[0] for ${description}`);
      return;
    }
  }

  // Single object - transfer directly (assume it's a valid TransactionObjectArgument)
  ptb.transferObjects([objects as TransactionObjectArgument], recipient);
  logger.debug(`✓ Transferred object for ${description}`);
}

/**
 * Safely extracts a nested result from a MoveCall without direct indexing.
 * Validates that the result exists at the specified index before extraction.
 * 
 * Rules:
 * - Never index result[x][0] directly
 * - Check existence before use
 * - Throw descriptive error if missing
 * 
 * @param result - The result from a MoveCall (can be single value, array, or indexable result)
 * @param index - The index to extract (typically 0 for first result)
 * @param description - Description of what's being extracted for error messages
 * @returns The extracted value at the specified index
 * @throws PTBHelperError if the result doesn't exist at the specified index
 * 
 * @example
 * ```typescript
 * const openPositionResult = ptb.moveCall({
 *   target: `${packageId}::pool_script::open_position`,
 *   arguments: [...]
 * });
 * 
 * // Safe extraction - throws descriptive error if missing
 * const newPosition = safeUseNestedResult(
 *   openPositionResult,
 *   0,
 *   'position NFT from open_position'
 * );
 * 
 * // Use the safely extracted position
 * ptb.moveCall({
 *   arguments: [newPosition, ...]
 * });
 * ```
 */
export function safeUseNestedResult<T = TransactionObjectArgument>(
  result: T | T[] | unknown,
  index: number,
  description: string
): T {
  // Validate index
  if (index < 0) {
    throw new PTBHelperError(
      `Cannot extract nested result: index ${index} is negative`,
      'safeUseNestedResult',
      description
    );
  }

  // Handle undefined/null result
  if (result === undefined) {
    throw new PTBHelperError(
      `Cannot extract nested result at index ${index}: result is undefined`,
      'safeUseNestedResult',
      description
    );
  }

  if (result === null) {
    throw new PTBHelperError(
      `Cannot extract nested result at index ${index}: result is null`,
      'safeUseNestedResult',
      description
    );
  }

  // Handle array result - never index directly, check first
  if (Array.isArray(result)) {
    // Check if index is within bounds
    if (index >= result.length) {
      throw new PTBHelperError(
        `Cannot extract nested result at index ${index}: array only has ${result.length} element(s)`,
        'safeUseNestedResult',
        description
      );
    }

    // Extract element at index safely
    const element = result[index];
    if (element === undefined) {
      throw new PTBHelperError(
        `Cannot extract nested result at index ${index}: element is undefined`,
        'safeUseNestedResult',
        description
      );
    }

    logger.debug(`✓ Extracted ${description} from result[${index}]`);
    return element as T;
  }

  // Handle object-like result with indexed access
  if (typeof result === 'object') {
    // Try to access the index
    const element = (result as IndexableResult)[index];
    if (element === undefined) {
      // If index is 0 and no [0] property, maybe the result itself is the value
      if (index === 0) {
        logger.debug(`✓ Using result directly as ${description} (no array indexing)`);
        return result as T;
      }

      throw new PTBHelperError(
        `Cannot extract nested result at index ${index}: element is undefined`,
        'safeUseNestedResult',
        description
      );
    }

    logger.debug(`✓ Extracted ${description} from result[${index}]`);
    return element as T;
  }

  // Single value result - only valid for index 0
  if (index === 0) {
    logger.debug(`✓ Using result directly as ${description}`);
    return result as T;
  }

  throw new PTBHelperError(
    `Cannot extract nested result at index ${index}: result is not an array or indexable object`,
    'safeUseNestedResult',
    description
  );
}

/**
 * Safely extracts a nested result with optional fallback.
 * Like safeUseNestedResult but returns undefined instead of throwing on failure.
 * 
 * @param result - The result from a MoveCall
 * @param index - The index to extract
 * @param description - Description for logging
 * @returns The extracted value or undefined if not found
 * 
 * @example
 * ```typescript
 * const position = safeUseNestedResultOptional(result, 0, 'position NFT');
 * if (position) {
 *   // Use position
 * } else {
 *   // Handle missing position
 * }
 * ```
 */
export function safeUseNestedResultOptional<T = TransactionObjectArgument>(
  result: T | T[] | unknown,
  index: number,
  description: string
): T | undefined {
  try {
    return safeUseNestedResult<T>(result, index, description);
  } catch (error) {
    if (error instanceof PTBHelperError) {
      logger.debug(`Optional extraction failed for ${description}: ${error.message}`);
      return undefined;
    }
    throw error;
  }
}
