import { logger } from './logger';

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  minDelay: number,
  maxDelay: number,
  context: string
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries) {
        const delay = Math.min(
          minDelay * Math.pow(2, attempt),
          maxDelay
        );
        
        logger.warn(
          `${context} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}. Retrying in ${delay}ms...`
        );
        
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  
  logger.error(`${context} failed after ${maxRetries + 1} attempts`);
  throw lastError;
}
