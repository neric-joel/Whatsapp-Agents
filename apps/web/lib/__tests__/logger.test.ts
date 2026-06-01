import { createLogger, type LogLevel } from '@agentroom/shared'
import { describe, expect, it } from 'vitest'

function capture(threshold?: LogLevel) {
  const lines: Array<{ rec: Record<string, unknown>; level: string }> = []
  const logger = createLogger({
    base: { service: 'test' },
    threshold,
    write: (line, level) => lines.push({ rec: JSON.parse(line), level }),
  })
  return { logger, lines }
}

describe('shared logger', () => {
  it('emits structured JSON with ts, level, event, and base fields', () => {
    const { logger, lines } = capture('debug')
    logger.info('run.start', { run_id: 'r1' })
    expect(lines).toHaveLength(1)
    const { rec } = lines[0]!
    expect(rec.level).toBe('info')
    expect(rec.event).toBe('run.start')
    expect(rec.service).toBe('test')
    expect(rec.run_id).toBe('r1')
    expect(typeof rec.ts).toBe('string')
  })

  it('redacts secrets/PII in field values', () => {
    const { logger, lines } = capture('debug')
    logger.error('api.internal_error', { detail: 'token=sk-abcdefghijklmnopqrstuvwxyz123' })
    expect(lines[0]!.rec.detail).toBe('token=[REDACTED]')
  })

  it('suppresses levels below the threshold', () => {
    const { logger, lines } = capture('info')
    logger.debug('poll.empty')
    logger.info('poll.found', { count: 1 })
    expect(lines.map((l) => l.rec.event)).toEqual(['poll.found'])
  })

  it('child() binds context (run_id) to every line', () => {
    const { logger, lines } = capture('debug')
    logger.child({ run_id: 'r2' }).warn('run.slow')
    expect(lines[0]!.rec.run_id).toBe('r2')
  })

  it('routes error level to the error sink', () => {
    const { logger, lines } = capture('debug')
    logger.error('boom')
    expect(lines[0]!.level).toBe('error')
  })
})
