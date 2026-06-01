import { createErrorTracker } from '@agentroom/shared'

import { logger } from './logger'

// Web error-tracking singleton. Opt-in via SENTRY_DSN / ERROR_TRACKING_DSN — a
// no-op when neither is set. Server-only (uses the Node logger); do NOT import
// into client components.
const tracker = createErrorTracker({
  dsn: process.env.SENTRY_DSN ?? process.env.ERROR_TRACKING_DSN,
  logger,
})

export function captureError(error: unknown, context?: Record<string, unknown>): boolean {
  return tracker.capture(error, context)
}
