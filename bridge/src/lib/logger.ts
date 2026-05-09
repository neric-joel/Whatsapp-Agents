const workerId = process.env['BRIDGE_WORKER_ID'] ?? 'bridge'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export function log(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    worker_id: workerId,
    ...fields,
  })
  if (level === 'error') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}
