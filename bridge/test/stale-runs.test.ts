import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { recoverStaleRuns } from '../src/lib/stale-runs.js'
import { freshTestDb, seedAgent, seedRoom, seedRun, type TestDb } from './helpers/test-db.js'

let h: TestDb

beforeEach(() => {
  h = freshTestDb()
})

afterEach(() => {
  h.cleanup()
})

// A fixed "now" so cutoff math is deterministic. staleMs = 60_000 => cutoff is
// exactly one minute earlier: 2026-05-17T03:40:00.000Z.
const NOW = () => new Date('2026-05-17T03:41:00.000Z').getTime()
const STALE_MS = 60_000
const CUTOFF = '2026-05-17T03:40:00.000Z'

/** ISO string `ms` milliseconds before the fixed NOW. */
function before(ms: number): string {
  return new Date(NOW() - ms).toISOString()
}

function statusOf(id: string): string | undefined {
  const row = h.db.prepare('SELECT status FROM agent_runs WHERE id = ?').get(id) as
    | { status: string }
    | undefined
  return row?.status
}

function getRun(id: string) {
  return h.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
}

test('stale query guards a NULL heartbeat by age (no instant-stale) and the recovery UPDATE is status-guarded', async () => {
  const roomId = seedRoom(h.db, { id: 'room-1' })
  const agentId = seedAgent(h.db, { id: 'agent-1' })

  // STALE: heartbeat older than the cutoff (older than staleMs ago) -> recovered.
  seedRun(h.db, roomId, agentId, {
    id: 'run-stale-hb',
    status: 'running',
    heartbeat_at: before(120_000), // 2 min ago, < cutoff
    started_at: before(180_000),
  })
  // STALE: NULL heartbeat but started_at older than the cutoff (age-guarded) -> recovered.
  seedRun(h.db, roomId, agentId, {
    id: 'run-stale-null-hb',
    status: 'claimed',
    heartbeat_at: null,
    started_at: before(120_000), // claimed 2 min ago, no heartbeat yet -> stale
  })
  // FRESH: recent heartbeat -> must NOT match.
  seedRun(h.db, roomId, agentId, {
    id: 'run-fresh-hb',
    status: 'running',
    heartbeat_at: before(5_000), // 5s ago, > cutoff
    started_at: before(180_000),
  })
  // NOT instant-stale: NULL heartbeat but freshly claimed (started_at recent).
  // This is the critical age guard: a just-claimed run has NULL heartbeat until
  // its first interval fires and must NOT be treated as stale.
  seedRun(h.db, roomId, agentId, {
    id: 'run-fresh-null-hb',
    status: 'claimed',
    heartbeat_at: null,
    started_at: before(5_000), // claimed 5s ago -> young, not stale
  })

  const recoveredIds: string[] = []
  const recovered = await recoverStaleRuns({
    staleMs: STALE_MS,
    now: NOW,
    reason: 'stale: recovered by periodic sweep',
    logRecovered: (id) => recoveredIds.push(id),
  })

  // Only the two genuinely-stale runs are recovered.
  assert.equal(recovered, 2)
  assert.deepEqual(recoveredIds.sort(), ['run-stale-hb', 'run-stale-null-hb'])

  // Stale runs flipped to 'failed' with the reason + completed_at set.
  for (const id of ['run-stale-hb', 'run-stale-null-hb']) {
    const row = getRun(id)
    assert.equal(row?.['status'], 'failed', `${id} should be failed`)
    assert.equal(row?.['error_message'], 'stale: recovered by periodic sweep')
    assert.equal(row?.['completed_at'], new Date(NOW()).toISOString())
  }

  // A recent (or NULL-but-young) heartbeat must NOT match: NULL only counts when
  // started_at is also older than the cutoff. Fresh runs are left untouched.
  assert.equal(statusOf('run-fresh-hb'), 'running', 'recent heartbeat is not stale')
  assert.equal(
    statusOf('run-fresh-null-hb'),
    'claimed',
    'NULL heartbeat is age-guarded against started_at (no instant-stale)',
  )
  // Fresh runs keep their untouched terminal fields.
  assert.equal(getRun('run-fresh-hb')?.['error_message'], null)
  assert.equal(getRun('run-fresh-hb')?.['completed_at'], null)
  assert.equal(getRun('run-fresh-null-hb')?.['completed_at'], null)

  // Sanity: the cutoff is exactly one staleMs before NOW.
  assert.equal(new Date(NOW() - STALE_MS).toISOString(), CUTOFF)
})

test('status guard: a run that left claimed/running between SELECT and UPDATE is NOT counted recovered', async () => {
  const roomId = seedRoom(h.db, { id: 'room-1' })
  const agentId = seedAgent(h.db, { id: 'agent-1' })

  // Two stale candidates by age. Both are selected, but run-1 is concurrently
  // completed by its worker between the SELECT and its UPDATE: the status guard
  // (WHERE ... AND status IN ('claimed','running')) must skip it so it is neither
  // counted nor clobbered from its terminal state.
  seedRun(h.db, roomId, agentId, {
    id: 'run-1',
    status: 'running',
    heartbeat_at: before(120_000),
    started_at: before(180_000),
  })
  seedRun(h.db, roomId, agentId, {
    id: 'run-2',
    status: 'running',
    heartbeat_at: before(120_000),
    started_at: before(180_000),
  })

  // Simulate the race: as soon as the first recovery UPDATE fires (logRecovered
  // is called right after a successful update), flip the OTHER candidate out of
  // claimed/running, exactly as a worker completing it would.
  let raced = false
  const recovered = await recoverStaleRuns({
    staleMs: STALE_MS,
    now: NOW,
    logRecovered: (id) => {
      if (!raced) {
        raced = true
        const other = id === 'run-1' ? 'run-2' : 'run-1'
        h.db
          .prepare(`UPDATE agent_runs SET status = 'completed', completed_at = ? WHERE id = ?`)
          .run(new Date(NOW()).toISOString(), other)
      }
    },
  })

  // Only the run still in claimed/running is recovered; the raced one is skipped.
  assert.equal(recovered, 1, 'only the run still in claimed/running is recovered')

  // Exactly one run ended 'failed' (recovered) and one stayed 'completed' (not clobbered).
  const statuses = (
    h.db.prepare('SELECT id, status FROM agent_runs ORDER BY id').all() as Array<{
      id: string
      status: string
    }>
  ).map((r) => r.status)
  assert.deepEqual(statuses.sort(), ['completed', 'failed'])
  // The completed run was never overwritten to 'failed' (terminal state preserved).
  const failedCount = (
    h.db.prepare(`SELECT COUNT(*) AS n FROM agent_runs WHERE status = 'failed'`).get() as {
      n: number
    }
  ).n
  assert.equal(failedCount, 1, 'the concurrently-completed run was not clobbered to failed')
})

test('no stale runs: returns 0 and never calls logRecovered', async () => {
  const roomId = seedRoom(h.db, { id: 'room-1' })
  const agentId = seedAgent(h.db, { id: 'agent-1' })

  // A fresh running run and a terminal run that is old but not claimed/running.
  seedRun(h.db, roomId, agentId, {
    id: 'run-fresh',
    status: 'running',
    heartbeat_at: before(1_000),
    started_at: before(60_000),
  })
  seedRun(h.db, roomId, agentId, {
    id: 'run-old-completed',
    status: 'completed',
    heartbeat_at: before(999_999), // very old, but not claimed/running
    started_at: before(999_999),
    completed_at: before(900_000),
  })

  let logCalls = 0
  const recovered = await recoverStaleRuns({
    staleMs: STALE_MS,
    now: NOW,
    logRecovered: () => {
      logCalls += 1
    },
  })

  assert.equal(recovered, 0)
  assert.equal(logCalls, 0)
  // Nothing was touched.
  assert.equal(statusOf('run-fresh'), 'running')
  assert.equal(statusOf('run-old-completed'), 'completed')
})
