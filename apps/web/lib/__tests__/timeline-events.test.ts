import { describe, expect, it } from 'vitest'

import { buildTimelineEvents } from '../timeline-events'

describe('buildTimelineEvents', () => {
  it('keeps failed runs beside the message that triggered them', () => {
    const messages = [
      { id: 'm1', created_at: '2026-05-16T01:00:00.000Z' },
      { id: 'm2', created_at: '2026-05-16T01:30:00.000Z' },
    ]
    const runs = [
      { id: 'r1', trigger_msg_id: 'm1', created_at: '2026-05-16T01:00:01.000Z' },
      { id: 'r2', trigger_msg_id: 'm2', created_at: '2026-05-16T01:30:01.000Z' },
    ]

    expect(buildTimelineEvents(messages, runs).map((event) => event.id)).toEqual([
      'message-m1',
      'run-r1',
      'message-m2',
      'run-r2',
    ])
  })

  it('places orphan runs by their own creation time', () => {
    const messages = [
      { id: 'm1', created_at: '2026-05-16T01:00:00.000Z' },
      { id: 'm2', created_at: '2026-05-16T01:30:00.000Z' },
    ]
    const runs = [{ id: 'r1', trigger_msg_id: 'missing', created_at: '2026-05-16T01:10:00.000Z' }]

    expect(buildTimelineEvents(messages, runs).map((event) => event.id)).toEqual([
      'message-m1',
      'run-r1',
      'message-m2',
    ])
  })
})
