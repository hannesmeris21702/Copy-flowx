/**
 * Debug Mode Utility
 * 
 * Controls verbose PTB (Programmable Transaction Block) debugging output
 * based on the DEBUG_MODE environment variable.
 * 
 * When DEBUG_MODE is enabled:
 * - Prints full PTB structure
 * - Prints command index mapping
 * - Prints expected vs actual PTB returns
 * 
 * When DEBUG_MODE is disabled:
 * - Uses clean production logs only
 */

/**
 * Check if debug mode is enabled
 * @returns true if DEBUG_MODE environment variable is set to 'true'
 */
export function isDebugMode(): boolean {
  return process.env.DEBUG_MODE === 'true';
}

/**
 * Log debug message only if debug mode is enabled
 * @param message Message or function that returns a message
 * @param ...args Additional arguments to log
 */
export function debugLog(message: string | (() => string), ...args: any[]): void {
  if (!isDebugMode()) {
    return;
  }
  
  const msg = typeof message === 'function' ? message() : message;
  console.log('[DEBUG]', msg, ...args);
}

/**
 * Execute a function only if debug mode is enabled
 * Useful for expensive debug operations that should be skipped in production
 * @param fn Function to execute in debug mode
 */
export function ifDebug(fn: () => void): void {
  if (isDebugMode()) {
    fn();
  }
}
