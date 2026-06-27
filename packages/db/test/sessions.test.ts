import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

const tmp = mkdtempSync(join(tmpdir(), 'agentroom-sessions-'))
process.env['AGENTROOM_DB_PATH'] = join(tmp, 'test.db')

const { getDb, closeDb, newId, rowToSession, rowToRoom, LOCAL_USER_ID } =
  await import('../src/index.js')

before(() => getDb())
after(() => {
  closeDb()
  rmSync(tmp, { recursive: true, force: true })
})

test('sessions table round-trips via rowToSession', () => {
  const db = getDb()
  const id = newId()
  db.prepare(
    'INSERT INTO sessions (id, name, working_dir, created_by_user_id) VALUES (?, ?, ?, ?)',
  ).run(id, 'My Session', 'C:/work/proj', LOCAL_USER_ID)
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown>
  const s = rowToSession(row)
  assert.equal(s.name, 'My Session')
  assert.equal(s.working_dir, 'C:/work/proj')
  assert.ok(s.last_active_at)
})

test('a room can be attached to a session via session_id and reads back', () => {
  const db = getDb()
  const sid = newId()
  db.prepare('INSERT INTO sessions (id, name, working_dir) VALUES (?, ?, ?)').run(sid, 'S', 'C:/w')
  const rid = newId()
  db.prepare(
    'INSERT INTO rooms (id, name, session_id, created_by_user_id) VALUES (?, ?, ?, ?)',
  ).run(rid, 'Scoped Room', sid, LOCAL_USER_ID)
  const room = rowToRoom(
    db.prepare('SELECT * FROM rooms WHERE id = ?').get(rid) as Record<string, unknown>,
  )
  assert.equal(room.session_id, sid)

  // A room with no session reads back null (backward compatible).
  const rid2 = newId()
  db.prepare('INSERT INTO rooms (id, name, created_by_user_id) VALUES (?, ?, ?)').run(
    rid2,
    'Legacy Room',
    LOCAL_USER_ID,
  )
  const legacy = rowToRoom(
    db.prepare('SELECT * FROM rooms WHERE id = ?').get(rid2) as Record<string, unknown>,
  )
  assert.equal(legacy.session_id, null)
})

test('a connected CLI is one agent per owner, reusable across rooms (no slug-unique clash)', () => {
  const db = getDb()
  // Mirrors the agents-route reuse logic: a CLI agent keyed by (owner, slug) is created
  // once, then attached to additional rooms via room_members — not re-inserted.
  const agentId = newId()
  db.prepare(
    `INSERT INTO agents (id, name, slug, provider, adapter_type, created_by_user_id) VALUES (?, 'Claude', 'claude', ?, 'cli', ?)`,
  ).run(agentId, 'profile-123', LOCAL_USER_ID)
  const r1 = newId()
  const r2 = newId()
  for (const rid of [r1, r2]) {
    db.prepare('INSERT INTO rooms (id, name, created_by_user_id) VALUES (?, ?, ?)').run(
      rid,
      'room',
      LOCAL_USER_ID,
    )
    db.prepare(
      `INSERT INTO room_members (id, room_id, agent_id, member_type) VALUES (?, ?, ?, 'agent')`,
    ).run(newId(), rid, agentId)
  }
  // The same agent is a member of BOTH rooms — no second agent row, no unique clash.
  const memberships = db
    .prepare("SELECT count(*) c FROM room_members WHERE agent_id = ? AND member_type='agent'")
    .get(agentId)
  assert.equal(memberships.c, 2)
  const agentCount = db.prepare('SELECT count(*) c FROM agents WHERE slug = ?').get('claude')
  assert.equal(agentCount.c, 1)
})

test('sessions sort most-recently-active first', () => {
  const db = getDb()
  db.prepare('DELETE FROM sessions').run()
  const a = newId()
  const b = newId()
  db.prepare(
    "INSERT INTO sessions (id, name, working_dir, last_active_at) VALUES (?, ?, ?, '2026-01-01T00:00:00Z')",
  ).run(a, 'old', 'C:/a')
  db.prepare(
    "INSERT INTO sessions (id, name, working_dir, last_active_at) VALUES (?, ?, ?, '2026-06-01T00:00:00Z')",
  ).run(b, 'new', 'C:/b')
  const rows = db.prepare('SELECT * FROM sessions ORDER BY last_active_at DESC').all() as Record<
    string,
    unknown
  >[]
  assert.equal(rowToSession(rows[0]!).name, 'new')
})
