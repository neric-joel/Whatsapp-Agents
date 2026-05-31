// Bridge logger — delegates to the shared structured JSON logger so web + bridge
// share one shape, redaction, and LOG_LEVEL behavior. The log(level, event, fields)
// signature is kept for existing call sites; `logger` (with .child({ run_id })) is
// exported for per-run correlation.
import { createLogger, type LogLevel } from '@agentroom/shared'

const logger = createLogger({
  base: { worker_id: process.env['BRIDGE_WORKER_ID'] ?? 'bridge' },
})

export function log(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  logger[level](event, fields)
}
