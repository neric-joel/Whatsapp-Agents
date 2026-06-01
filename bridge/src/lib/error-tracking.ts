// Bridge error-tracking singleton. Opt-in via SENTRY_DSN / ERROR_TRACKING_DSN —
// a no-op when neither is set (no dependency, no network). See the shared module
// for the contract; the default transport routes through the structured logger.
import { createErrorTracker } from '@agentroom/shared'

import { logger } from './logger.js'

const tracker = createErrorTracker({
  dsn: process.env['SENTRY_DSN'] ?? process.env['ERROR_TRACKING_DSN'],
  logger, // carries worker_id so captured-error lines correlate in a multi-worker drain
})

/** Forward an error to the configured tracker. Returns whether it was forwarded. */
export function captureError(error: unknown, context?: Record<string, unknown>): boolean {
  return tracker.capture(error, context)
}

export const errorTrackingEnabled = tracker.enabled
