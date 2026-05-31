import { createErrorTracker } from '@agentroom/shared'
import { describe, expect, it, vi } from 'vitest'

describe('error tracking (opt-in)', () => {
  it('is disabled and capture() is a no-op when no DSN is configured', () => {
    const transport = vi.fn()
    const tracker = createErrorTracker({ transport })
    expect(tracker.enabled).toBe(false)
    expect(tracker.capture(new Error('boom'))).toBe(false)
    expect(transport).not.toHaveBeenCalled()
  })

  it('treats an empty/whitespace DSN as disabled', () => {
    const transport = vi.fn()
    expect(createErrorTracker({ dsn: '', transport }).capture(new Error('x'))).toBe(false)
    expect(createErrorTracker({ dsn: '   ', transport }).capture(new Error('x'))).toBe(false)
    expect(transport).not.toHaveBeenCalled()
  })

  it('forwards through the transport when a DSN is set', () => {
    const transport = vi.fn()
    const tracker = createErrorTracker({ dsn: 'https://key@example.com/1', transport })
    expect(tracker.enabled).toBe(true)
    expect(tracker.capture(new Error('kaboom'), { run_id: 'r1' })).toBe(true)
    expect(transport).toHaveBeenCalledTimes(1)
    const event = transport.mock.calls[0]![0]
    expect(event.message).toBe('kaboom')
    expect(event.stack).toContain('Error')
    expect(event.context).toEqual({ run_id: 'r1' })
  })

  it('captures non-Error values by stringifying them', () => {
    const transport = vi.fn()
    const tracker = createErrorTracker({ dsn: 'dsn', transport })
    expect(tracker.capture('plain string')).toBe(true)
    expect(transport.mock.calls[0]![0].message).toBe('plain string')
  })

  it('never throws if the transport throws (returns false)', () => {
    const tracker = createErrorTracker({
      dsn: 'dsn',
      transport: () => {
        throw new Error('transport down')
      },
    })
    expect(tracker.capture(new Error('boom'))).toBe(false)
  })

  it('default transport routes through the provided logger (redacted)', () => {
    const lines: Array<Record<string, unknown>> = []
    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (event: string, fields?: Record<string, unknown>) =>
        lines.push({ event, ...(fields ?? {}) }),
      child: () => logger,
    }
    const tracker = createErrorTracker({ dsn: 'dsn', logger })
    tracker.capture(new Error('disk full'), { run_id: 'r9' })
    const rec = lines.find((l) => l.event === 'error.captured')
    expect(rec).toBeTruthy()
    expect(rec!.message).toBe('disk full')
    expect(rec!.error_tracking).toBe(true)
    expect(rec!.run_id).toBe('r9')
  })
})
