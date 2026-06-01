// Structured JSON logger shared by web + bridge. One JSON line per event:
// { ts, level, event, ...base, ...bound, ...fields }. Every string field value is
// run through redact() so secrets/PII cannot leak via logs. Level threshold from
// LOG_LEVEL (default 'info'); error -> stderr, everything else -> stdout.
import { redactDeep } from './redact.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function envThreshold(): number {
  const raw = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase()
  return LEVEL_ORDER[raw as LogLevel] ?? LEVEL_ORDER.info
}

function toThreshold(t: LogLevel | number | undefined): number {
  if (typeof t === 'number') return t
  if (typeof t === 'string') return LEVEL_ORDER[t] ?? LEVEL_ORDER.info
  return envThreshold()
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void
  info(event: string, fields?: Record<string, unknown>): void
  warn(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
  /** Return a logger that adds `bound` fields (e.g. { run_id }) to every line. */
  child(bound: Record<string, unknown>): Logger
}

interface LoggerOptions {
  /** Fields added to every line (e.g. { service: 'agentroom-web' } or { worker_id }). */
  base?: Record<string, unknown>
  /** Minimum level to emit, as a level name or numeric order. Defaults to LOG_LEVEL env. */
  threshold?: LogLevel | number
  /** Sink override (tests): receives the final JSON line + its level. */
  write?: (line: string, level: LogLevel) => void
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const base = options.base ?? {}
  const threshold = toThreshold(options.threshold)
  const sink =
    options.write ??
    ((line: string, level: LogLevel) => {
      if (level === 'error') process.stderr.write(line + '\n')
      else process.stdout.write(line + '\n')
    })

  function make(bound: Record<string, unknown>): Logger {
    const emit = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
      if (LEVEL_ORDER[level] < threshold) return
      const safe = redactDeep({ ...base, ...bound, ...fields }) as Record<string, unknown>
      sink(JSON.stringify({ ts: new Date().toISOString(), level, event, ...safe }), level)
    }
    return {
      debug: (e, f) => emit('debug', e, f),
      info: (e, f) => emit('info', e, f),
      warn: (e, f) => emit('warn', e, f),
      error: (e, f) => emit('error', e, f),
      child: (extra) => make({ ...bound, ...extra }),
    }
  }

  return make({})
}
