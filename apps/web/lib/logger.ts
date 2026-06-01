import { createLogger, type Logger } from '@agentroom/shared'

// Server-side structured logger for the web app (route handlers, instrumentation).
// Emits redacted JSON lines tagged with service='agentroom-web'. Do NOT import this
// into client components — it writes to process.stdout (Node only).
export const logger: Logger = createLogger({ base: { service: 'agentroom-web' } })
