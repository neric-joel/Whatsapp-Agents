import assert from 'node:assert/strict'
import { test } from 'node:test'

import { writeHeartbeats } from '../src/lib/heartbeat.js'
import { freshTestDb, seedAgent, seedRoom, seedRun } from './helpers/test-db.js'

test('writeHeartbeats bumps heartbeat_at on exactly the given runs', () => {
  const h = freshTestDb()
  try {
    seedRoom(h.db, { id: 'room-1' })
    seedAgent(h.db, { id: 'agent-1' })
    seedRun(h.db, 'room-1', 'agent-1', { id: 'run-a', status: 'running' })
    seedRun(h.db, 'room-1', 'agent-1', { id: 'run-b', status: 'running' })
    seedRun(h.db, 'room-1', 'agent-1', { id: 'run-c', status: 'queued' })

    const now = '2030-01-01T00:00:00.000Z'
    const n = writeHeartbeats(h.db, ['run-a', 'run-b'], now)
    assert.equal(n, 2)

    const hb = (id: string) =>
      (
        h.db.prepare('SELECT heartbeat_at AS h FROM agent_runs WHERE id = ?').get(id) as {
          h: string | null
        }
      ).h
    assert.equal(hb('run-a'), now)
    assert.equal(hb('run-b'), now)
    assert.equal(hb('run-c'), null, 'a run not in the set must be untouched')

    assert.equal(writeHeartbeats(h.db, [], now), 0, 'empty set is a no-op')
  } finally {
    h.cleanup()
  }
})
