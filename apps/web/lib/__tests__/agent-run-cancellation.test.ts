import { describe, expect, it } from 'vitest'

import { buildCancelledRunPatch, isCancellableRunStatus } from '../agent-run-cancellation'

describe('agent run cancellation', () => {
  it('allows only active run statuses to be cancelled', () => {
    expect(isCancellableRunStatus('queued')).toBe(true)
    expect(isCancellableRunStatus('claimed')).toBe(true)
    expect(isCancellableRunStatus('running')).toBe(true)
    expect(isCancellableRunStatus('completed')).toBe(false)
    expect(isCancellableRunStatus('failed')).toBe(false)
    expect(isCancellableRunStatus('cancelled')).toBe(false)
  })

  it('builds a cancelled run patch with completion time', () => {
    expect(buildCancelledRunPatch('2026-05-17T04:00:00.000Z')).toEqual({
      status: 'cancelled',
      error_message: 'Cancelled by user',
      completed_at: '2026-05-17T04:00:00.000Z',
    })
  })
})

