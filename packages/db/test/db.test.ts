import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

// Point the DB at a throwaway file BEFORE importing the module (getDb reads the
// path lazily, so setting it here is enough).
const tmp = mkdtempSync(join(tmpdir(), 'agentroom-db-'))
process.env['AGENTROOM_DB_PATH'] = join(tmp, 'test.db')

const { getDb, closeDb, LOCAL_USER_ID, newId } = await import('../src/index.js')

before(() => {
  getDb()
})

after(() => {
  closeDb()
  rmSync(tmp, { recursive: true, force: true })
})

test('fresh install seeds one room with three agents as members', () => {
  const db = getDb()
  // v2: an empty starter room, NO forced pre-built agents (the user picks from a catalog).
  assert.equal((db.prepare('SELECT count(*) c FROM rooms').get() as { c: number }).c, 1)
  assert.equal((db.prepare('SELECT count(*) c FROM agents').get() as { c: number }).c, 0)
  assert.equal(
    (
      db.prepare("SELECT count(*) c FROM room_members WHERE member_type='agent'").get() as {
        c: number
      }
    ).c,
    0,
  )
  const owner = db.prepare('SELECT created_by_user_id o FROM rooms LIMIT 1').get() as { o: string }
  assert.equal(owner.o, LOCAL_USER_ID)
})

test('messages round-trip with ISO timestamps and defaults', () => {
  const db = getDb()
  const roomId = (db.prepare('SELECT id FROM rooms LIMIT 1').get() as { id: string }).id
  const id = newId()
  db.prepare(
    `INSERT INTO messages (id, room_id, sender_type, sender_user_id, content, content_type)
     VALUES (?, ?, 'user', ?, 'hello world', 'text')`,
  ).run(id, roomId, LOCAL_USER_ID)
  const row = db
    .prepare('SELECT content, mentions, metadata, created_at FROM messages WHERE id = ?')
    .get(id) as {
    content: string
    mentions: string
    metadata: string
    created_at: string
  }
  assert.equal(row.content, 'hello world')
  assert.equal(row.mentions, '[]')
  assert.equal(row.metadata, '{}')
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
})

test('agent_runs status-guarded claim is atomic (only one claimant wins)', () => {
  const db = getDb()
  const roomId = (db.prepare('SELECT id FROM rooms LIMIT 1').get() as { id: string }).id
  // No agents are seeded in v2, so create one for this run.
  const agentId = newId()
  db.prepare(
    `INSERT INTO agents (id, name, slug, provider, adapter_type, created_by_user_id) VALUES (?, 'A', 'a', 'mock', 'mock', ?)`,
  ).run(agentId, LOCAL_USER_ID)
  const runId = newId()
  db.prepare(
    `INSERT INTO agent_runs (id, room_id, agent_id, status) VALUES (?, ?, ?, 'queued')`,
  ).run(runId, roomId, agentId)

  const claim = db.prepare(
    `UPDATE agent_runs SET status='claimed', worker_id=?, started_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     WHERE id=? AND status='queued'`,
  )
  const first = claim.run('worker-a', runId)
  const second = claim.run('worker-b', runId)
  assert.equal(first.changes, 1, 'first claim wins')
  assert.equal(second.changes, 0, 'second claim is a no-op (already claimed)')
  const who = db.prepare('SELECT worker_id w, status s FROM agent_runs WHERE id=?').get(runId) as {
    w: string
    s: string
  }
  assert.equal(who.w, 'worker-a')
  assert.equal(who.s, 'claimed')
})

test('updated_at trigger bumps on UPDATE', () => {
  const db = getDb()
  const roomId = (db.prepare('SELECT id FROM rooms LIMIT 1').get() as { id: string }).id
  const before = (
    db.prepare('SELECT updated_at u FROM rooms WHERE id=?').get(roomId) as { u: string }
  ).u
  // force a distinct timestamp tick
  db.prepare("UPDATE rooms SET name='Renamed Room' WHERE id=?").run(roomId)
  const after = db.prepare('SELECT updated_at u, name n FROM rooms WHERE id=?').get(roomId) as {
    u: string
    n: string
  }
  assert.equal(after.n, 'Renamed Room')
  assert.ok(after.u >= before, 'updated_at is monotonic on update')
})
