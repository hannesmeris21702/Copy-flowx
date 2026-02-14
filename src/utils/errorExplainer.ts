/**
 * Error Explainer for Sui and Cetus Protocol Errors
 * 
 * Provides human-readable explanations and concrete fixes for common blockchain errors
 */

/**
 * Error explanation structure
 */
interface ErrorExplanation {
  name: string;
  description: string;
  causes: string[];
  fixes: string[];
  examples?: string[];
}

/**
 * Map of known Sui and Cetus protocol errors with explanations and fixes
 */
const ERROR_MAP: Record<string, ErrorExplanation> = {
  SecondaryIndexOutOfBounds: {
    name: 'SecondaryIndexOutOfBounds',
    description: 'Attempted to access a nested result from a PTB (Programmable Transaction Block) command that doesn\'t exist',
    causes: [
      'Trying to access result[x][y] when the command at index x didn\'t return y+1 results',
      'Referencing outputs from a MoveCall that returned fewer results than expected',
      'Accessing array index on a command that returned a single value or empty result',
      'collect_fee or close_position returning 0 coins but code assumes coins exist'
    ],
    fixes: [
      'Use safeUseNestedResult() helper to validate results exist before accessing',
      'Check if MoveCall will return results before referencing outputs',
      'Call functions for side-effects only (don\'t capture return value) if unsure',
      'Use conditional logic: if (result && result[0]) before accessing nested results',
      'Validate command result count before destructuring'
    ],
    examples: [
      'Bad: const [coin] = result;  // May not exist',
      'Good: const coin = safeUseNestedResult(result, 0, "description");',
      'Bad: ptb.moveCall(...); const [output] = someResult;  // Assumes result',
      'Good: Check position.liquidity > 0 before assuming coins exist'
    ]
  },

  CommandArgumentError: {
    name: 'CommandArgumentError',
    description: 'Invalid argument provided to a PTB command',
    causes: [
      'Wrong argument type (e.g., passing string where object expected)',
      'Incorrect number of arguments for a MoveCall',
      'Type argument mismatch (e.g., wrong coin types)',
      'Invalid object reference or ID',
      'Malformed transaction argument'
    ],
    fixes: [
      'Verify argument types match the Move function signature',
      'Check type arguments are properly normalized (use normalizeTypeArguments)',
      'Ensure object IDs are valid and in correct format',
      'Validate coin types match pool configuration',
      'Use ptb.pure.* helpers for primitive types (u64, bool, address)',
      'Check argument count matches function parameters'
    ],
    examples: [
      'Bad: ptb.moveCall({ arguments: [poolId] })  // Missing type wrapper',
      'Good: ptb.moveCall({ arguments: [ptb.object(poolId)] })',
      'Bad: typeArguments: [coinTypeA, coinTypeB]  // May have wrong format',
      'Good: typeArguments: normalizeTypeArguments([coinTypeA, coinTypeB])'
    ]
  },

  InsufficientGas: {
    name: 'InsufficientGas',
    description: 'Transaction gas budget is insufficient to execute the transaction',
    causes: [
      'Gas budget set too low for complex transaction',
      'Account has insufficient SUI balance for gas',
      'Transaction is too large or complex',
      'Gas price increased but budget wasn\'t adjusted'
    ],
    fixes: [
      'Increase gas budget in transaction options',
      'Check wallet SUI balance is sufficient',
      'Simplify transaction (reduce number of commands)',
      'Split complex transaction into multiple smaller ones',
      'Use checkGasPrice() before executing transaction',
      'Set higher gas budget: { gasBudget: 100000000 } (0.1 SUI)'
    ],
    examples: [
      'Check: await suiClient.checkGasPrice();',
      'Set budget: const tx = new Transaction(); tx.setGasBudget(100000000);',
      'Verify balance: await client.getBalance({ owner: address })'
    ]
  },

  MoveAbort: {
    name: 'MoveAbort',
    description: 'Move function execution aborted with an error code',
    causes: [
      'Assertion failed in Move smart contract (abort code in error)',
      'Invalid state or precondition not met',
      'Insufficient liquidity in pool',
      'Slippage tolerance exceeded',
      'Position out of range or invalid',
      'Permission denied or unauthorized action'
    ],
    fixes: [
      'Check the abort code in error message for specific reason',
      'Verify pool has sufficient liquidity before swap',
      'Increase slippage tolerance if price moved',
      'Ensure position is within valid tick range',
      'Check position ownership before operations',
      'Validate all preconditions before calling function',
      'Common Cetus codes: 1001 (empty position), 2001 (no fees), 4001 (close returns 0 coins)'
    ],
    examples: [
      'Abort 1001: Position has no liquidity',
      'Abort 2001: No fees to collect',
      'Abort 4001: close_position returned 0 coins',
      'Check: if (position.liquidity > 0) { /* safe to operate */ }'
    ]
  },

  TypeArgumentMismatch: {
    name: 'TypeArgumentMismatch',
    description: 'Type arguments don\'t match expected types or are malformed',
    causes: [
      'Coin types don\'t match pool configuration',
      'Type arguments not properly normalized',
      'Using shortened address format where full format required',
      'Type argument order is incorrect (A before B)',
      'Parsing error in type tag'
    ],
    fixes: [
      'Use normalizeTypeArguments() to convert to canonical format',
      'Verify coin types match pool.coinTypeA and pool.coinTypeB',
      'Ensure type arguments are in correct order',
      'Check type tags parse correctly with TypeTagSerializer',
      'Use validateTypeArguments() to verify normalization'
    ],
    examples: [
      'Bad: typeArgs: ["0x2::sui::SUI"]  // Shortened format',
      'Good: typeArgs: normalizeTypeArguments(["0x0000...0002::sui::SUI"])',
      'Verify: validateTypeArguments(typeArgs) returns true'
    ]
  },

  InvalidObjectReference: {
    name: 'InvalidObjectReference',
    description: 'Referenced object doesn\'t exist or is not owned by the sender',
    causes: [
      'Object ID is incorrect or doesn\'t exist',
      'Object was already consumed in previous command',
      'Object not owned by transaction sender',
      'Object is immutable when mutable reference required',
      'Shared object not properly referenced'
    ],
    fixes: [
      'Verify object exists: await client.getObject({ id: objectId })',
      'Check object ownership matches sender address',
      'Don\'t reference object after it\'s consumed/transferred',
      'Use ptb.object() for owned objects',
      'Use ptb.sharedObjectRef() for shared objects with initial version',
      'Refresh object state if it may have changed'
    ],
    examples: [
      'Check existence: const obj = await client.getObject({ id });',
      'Verify owner: obj.data.owner === senderAddress',
      'Don\'t reuse: ptb.transferObjects([nft], ...); // nft consumed, can\'t use again'
    ]
  },

  ObjectNotFound: {
    name: 'ObjectNotFound',
    description: 'Object with specified ID was not found on chain',
    causes: [
      'Object ID is incorrect or typo in address',
      'Object was deleted or consumed',
      'Using object ID from different network (testnet vs mainnet)',
      'Object hasn\'t been created yet'
    ],
    fixes: [
      'Verify object ID is correct',
      'Check you\'re on the correct network (testnet/mainnet)',
      'Query recent transactions to see if object was consumed',
      'If creating object, ensure previous transaction succeeded',
      'Use explorer to verify object exists'
    ],
    examples: [
      'Verify network: config.rpcUrl matches object network',
      'Check explorer: https://suiscan.xyz/{network}/object/{objectId}'
    ]
  },

  InsufficientCoinBalance: {
    name: 'InsufficientCoinBalance',
    description: 'Not enough coins available for the operation',
    causes: [
      'Wallet doesn\'t have enough of the specified coin type',
      'Trying to merge/split more coins than available',
      'Previous commands consumed the coins',
      'Coin balance is less than minimum required for operation'
    ],
    fixes: [
      'Check coin balance: await client.getBalance({ owner, coinType })',
      'Ensure sufficient balance before operations',
      'Don\'t consume coins before they\'re needed',
      'Use coinWithBalance() to create coins with specific amounts',
      'Handle zero-balance case gracefully'
    ],
    examples: [
      'Check: const balance = await client.getBalance({ owner, coinType });',
      'Create: const coin = coinWithBalance({ type, balance: 1000 })(ptb);'
    ]
  },

  InvalidSignature: {
    name: 'InvalidSignature',
    description: 'Transaction signature is invalid or doesn\'t match sender',
    causes: [
      'Private key doesn\'t match sender address',
      'Transaction was modified after signing',
      'Wrong keypair used for signing',
      'Signature format is incorrect'
    ],
    fixes: [
      'Verify private key matches sender address',
      'Don\'t modify transaction after signing',
      'Use correct keypair for the sender',
      'Check key derivation path if using HD wallet',
      'Ensure keypair format: Ed25519Keypair.fromSecretKey()'
    ],
    examples: [
      'Verify: keypair.getPublicKey().toSuiAddress() === senderAddress',
      'Sign: await client.signAndExecuteTransaction({ transaction, signer })'
    ]
  },

  TransactionExpired: {
    name: 'TransactionExpired',
    description: 'Transaction expired before execution',
    causes: [
      'Transaction took too long to execute',
      'Network congestion delayed execution',
      'Expiration time set too short',
      'Clock skew between client and network'
    ],
    fixes: [
      'Retry the transaction',
      'Increase expiration time if possible',
      'Execute transaction immediately after building',
      'Check network status for congestion',
      'Ensure client system clock is accurate'
    ],
    examples: [
      'Retry: await withRetry(() => executeTransaction(tx));',
      'Build and execute immediately: const tx = new Transaction(); await execute(tx);'
    ]
  }
};

/**
 * Error explanation result
 */
export interface ExplainedError {
  matched: boolean;
  errorType: string;
  explanation?: ErrorExplanation;
  originalError: string;
  suggestion: string;
}

/**
 * Extract error name from various error formats
 */
function extractErrorName(error: Error | string): string {
  const errorStr = typeof error === 'string' ? error : error.message;
  
  // Try to match known error patterns
  for (const errorName of Object.keys(ERROR_MAP)) {
    if (errorStr.includes(errorName)) {
      return errorName;
    }
  }
  
  // Check for common variations and aliases
  if (errorStr.toLowerCase().includes('gas') || 
      errorStr.includes('budget') || 
      errorStr.includes('IntentBudgetError')) {
    return 'InsufficientGas';
  }
  
  if (errorStr.includes('type') && (errorStr.includes('argument') || errorStr.includes('mismatch'))) {
    return 'TypeArgumentMismatch';
  }
  
  if (errorStr.includes('MoveAbort') || errorStr.includes('abort')) {
    return 'MoveAbort';
  }
  
  if (errorStr.includes('signature')) {
    return 'InvalidSignature';
  }
  
  if (errorStr.includes('expired')) {
    return 'TransactionExpired';
  }
  
  if (errorStr.includes('ObjectNotFound') || errorStr.includes('not found')) {
    return 'ObjectNotFound';
  }
  
  if (errorStr.includes('InvalidObjectReference') || errorStr.includes('invalid object')) {
    return 'InvalidObjectReference';
  }
  
  if (errorStr.includes('InsufficientCoinBalance') || errorStr.includes('insufficient balance')) {
    return 'InsufficientCoinBalance';
  }
  
  return 'Unknown';
}

/**
 * Explain a Sui or Cetus error with actionable suggestions
 * 
 * @param error - Error object or error message string
 * @returns Detailed explanation with causes and fixes
 * 
 * @example
 * ```typescript
 * try {
 *   await executeTransaction();
 * } catch (error) {
 *   const explained = explainError(error);
 *   if (explained.matched) {
 *     console.log(explained.explanation.description);
 *     console.log('Fixes:', explained.explanation.fixes);
 *   }
 * }
 * ```
 */
export function explainError(error: Error | string): ExplainedError {
  const errorStr = typeof error === 'string' ? error : error.message;
  const errorName = extractErrorName(error);
  
  const explanation = ERROR_MAP[errorName];
  
  if (explanation) {
    return {
      matched: true,
      errorType: errorName,
      explanation,
      originalError: errorStr,
      suggestion: formatSuggestion(explanation)
    };
  }
  
  // Unknown error - provide generic guidance
  return {
    matched: false,
    errorType: 'Unknown',
    originalError: errorStr,
    suggestion: 'Unknown error. Check error message for details. Common issues: gas, type arguments, object references, or move abort codes.'
  };
}

/**
 * Format explanation into a concise suggestion string
 */
function formatSuggestion(explanation: ErrorExplanation): string {
  const primaryFix = explanation.fixes[0];
  const additionalFixes = explanation.fixes.length > 1 ? ` (${explanation.fixes.length - 1} more solutions available)` : '';
  return `${explanation.description}\n\nQuick fix: ${primaryFix}${additionalFixes}`;
}

/**
 * Get a formatted error report
 */
export function getErrorReport(error: Error | string): string {
  const explained = explainError(error);
  
  if (!explained.matched) {
    return `Error: ${explained.originalError}\n\nNo specific explanation available for this error.`;
  }
  
  const exp = explained.explanation!;
  
  let report = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `ERROR: ${exp.name}\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  report += `${exp.description}\n\n`;
  
  report += `POSSIBLE CAUSES:\n`;
  exp.causes.forEach((cause, idx) => {
    report += `  ${idx + 1}. ${cause}\n`;
  });
  
  report += `\nSUGGESTED FIXES:\n`;
  exp.fixes.forEach((fix, idx) => {
    report += `  ${idx + 1}. ${fix}\n`;
  });
  
  if (exp.examples && exp.examples.length > 0) {
    report += `\nEXAMPLES:\n`;
    exp.examples.forEach(example => {
      report += `  ${example}\n`;
    });
  }
  
  report += `\nORIGINAL ERROR:\n${explained.originalError}\n`;
  
  return report;
}

/**
 * Check if an error is a known type
 */
export function isKnownError(error: Error | string): boolean {
  const errorName = extractErrorName(error);
  return errorName !== 'Unknown';
}

/**
 * Get list of all known error types
 */
export function getKnownErrorTypes(): string[] {
  return Object.keys(ERROR_MAP);
}
