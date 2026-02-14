import * as Sentry from '@sentry/node';
import { logger } from './logger';

/**
 * Initialize Sentry for error tracking and monitoring
 * 
 * This should be called as early as possible in the application lifecycle,
 * before other imports to ensure proper instrumentation.
 */
export function initSentry(): void {
  const sentryDsn = process.env.SENTRY_DSN;
  
  if (!sentryDsn) {
    logger.warn('SENTRY_DSN not configured - Sentry error tracking disabled');
    return;
  }
  
  // Parse and validate trace sample rate
  let tracesSampleRate = 0.1; // Default value
  if (process.env.SENTRY_TRACES_SAMPLE_RATE) {
    const parsed = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE);
    if (isNaN(parsed) || parsed < 0 || parsed > 1) {
      logger.warn(
        `Invalid SENTRY_TRACES_SAMPLE_RATE: ${process.env.SENTRY_TRACES_SAMPLE_RATE}. ` +
        `Must be between 0 and 1. Using default: ${tracesSampleRate}`
      );
    } else {
      tracesSampleRate = parsed;
    }
  }
  
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV || 'production',
    
    // Set tracesSampleRate to capture performance data
    // In production, you might want to lower this to reduce overhead
    tracesSampleRate,
    
    // Set release if available (useful for tracking which version had errors)
    release: process.env.npm_package_version,
    
    // Configure what gets sent to Sentry
    beforeSend(event, hint) {
      // Log that we're sending to Sentry (for debugging)
      logger.debug('Sending error to Sentry', { 
        eventId: event.event_id,
        exception: hint.originalException 
      });
      return event;
    },
  });
  
  logger.info('Sentry initialized successfully');
}

/**
 * Set context for the current transaction
 * This metadata will be attached to all errors reported within this scope
 */
export function setSentryContext(context: {
  poolId?: string;
  positionId?: string;
  stage?: string;
  commandIndex?: number;
}): void {
  if (!Sentry.isEnabled()) {
    return;
  }
  
  Sentry.setContext('rebalance', {
    poolId: context.poolId,
    positionId: context.positionId,
    stage: context.stage,
    commandIndex: context.commandIndex,
  });
  
  // Also set as tags for easier filtering in Sentry
  if (context.poolId) {
    Sentry.setTag('poolId', context.poolId);
  }
  if (context.positionId) {
    Sentry.setTag('positionId', context.positionId);
  }
  if (context.stage) {
    Sentry.setTag('ptb_stage', context.stage);
  }
  if (context.commandIndex !== undefined) {
    Sentry.setTag('command_index', context.commandIndex.toString());
  }
}

/**
 * Add a breadcrumb for tracking the sequence of operations
 */
export function addSentryBreadcrumb(message: string, category: string, data?: Record<string, any>): void {
  if (!Sentry.isEnabled()) {
    return;
  }
  
  Sentry.addBreadcrumb({
    message,
    category,
    level: 'info',
    data,
  });
}

/**
 * Capture an exception in Sentry
 */
export function captureException(error: Error | unknown, context?: {
  poolId?: string;
  positionId?: string;
  stage?: string;
  commandIndex?: number;
}): void {
  if (!Sentry.isEnabled()) {
    return;
  }
  
  // If context is provided, set it before capturing
  if (context) {
    Sentry.withScope((scope) => {
      scope.setContext('rebalance', context);
      
      if (context.poolId) {
        scope.setTag('poolId', context.poolId);
      }
      if (context.positionId) {
        scope.setTag('positionId', context.positionId);
      }
      if (context.stage) {
        scope.setTag('ptb_stage', context.stage);
      }
      if (context.commandIndex !== undefined) {
        scope.setTag('command_index', context.commandIndex.toString());
      }
      
      Sentry.captureException(error);
    });
  } else {
    Sentry.captureException(error);
  }
}

/**
 * Flush all pending Sentry events
 * Useful before shutting down the application
 */
export async function flushSentry(timeout = 2000): Promise<boolean> {
  if (!Sentry.isEnabled()) {
    return true;
  }
  
  try {
    return await Sentry.flush(timeout);
  } catch (error) {
    logger.error('Failed to flush Sentry events', error);
    return false;
  }
}

// Export Sentry for direct access if needed
export { Sentry };
