// Opt-in error tracking, shared by web + bridge. It is a NO-OP unless a DSN is
// configured — installing it costs nothing and adds no dependency when unused.
//
// Design: dependency-free. The default transport, when a DSN is present, records
// the captured error through the structured logger (one redacted JSON line tagged
// error_tracking:true) so it shows up in whatever log drain is already wired. A
// real Sentry/OTLP transport can be injected via `transport` without changing any
// call site. `capture()` returns true iff the error was forwarded — this is what
// the unit tests assert for the no-op-without-DSN contract.
import { createLogger, type Logger } from './logger.js'

export interface ErrorTrackerConfig {
  /** DSN/endpoint. Empty/undefined ⇒ tracker disabled (capture is a no-op). */
  dsn?: string | undefined
  /** Logger for the default transport + self-diagnostics. Defaults to a new logger. */
  logger?: Logger
  /** Override how a captured error is forwarded (e.g. POST to Sentry). */
  transport?: (event: CapturedErrorEvent) => void
}

export interface CapturedErrorEvent {
  message: string
  stack?: string
  context?: Record<string, unknown>
}

export interface ErrorTracker {
  /** True when a DSN is configured and capture() forwards. */
  readonly enabled: boolean
  /** Forward an error if enabled. Returns whether it was forwarded. Never throws. */
  capture(error: unknown, context?: Record<string, unknown>): boolean
}

function toEvent(error: unknown, context?: Record<string, unknown>): CapturedErrorEvent {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(context ? { context } : {}),
    }
  }
  return { message: String(error), ...(context ? { context } : {}) }
}

export function createErrorTracker(config: ErrorTrackerConfig = {}): ErrorTracker {
  const dsn = config.dsn?.trim()
  const enabled = Boolean(dsn)
  const logger = config.logger ?? createLogger({ base: { component: 'error-tracking' } })

  // Default transport: surface through the structured (redacted) logger.
  const transport =
    config.transport ??
    ((event: CapturedErrorEvent) => {
      logger.error('error.captured', {
        error_tracking: true,
        message: event.message,
        ...(event.stack ? { stack: event.stack } : {}),
        ...(event.context ?? {}),
      })
    })

  if (enabled) {
    logger.info('error.tracking.enabled', {})
  }

  return {
    enabled,
    capture(error: unknown, context?: Record<string, unknown>): boolean {
      if (!enabled) return false
      try {
        transport(toEvent(error, context))
        return true
      } catch {
        // Error tracking must never break the caller's error path.
        return false
      }
    },
  }
}
