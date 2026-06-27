import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { closeDb, getDb, newId } from '@agentroom/db'

/**
 * Test harness for the local SQLite data layer.
 *
 * The bridge modules call getDb() (a process-wide singleton) internally, so a test
 * just points the DB at a throwaway file and seeds the rows it needs. `freshTestDb()`
 * opens a clean DB (the first-run seed is wiped so fixtures are deterministic) and
 * returns a cleanup that closes + deletes it.
 *
 * Usage:
 *   let h
 *   beforeEach(() => { h = freshTestDb() })
 *   afterEach(() => h.cleanup())
 */
export interface TestDb {
  db: ReturnType<typeof getDb>
  dir: string
  cleanup(): void
}

export function freshTestDb(): TestDb {
  closeDb() // drop any singleton from a previous test in this process
  const dir = mkdtempSync(join(tmpdir(), 'agentroom-bridge-test-'))
  process.env['AGENTROOM_DB_PATH'] = join(dir, 'test.db')
  process.env['AGENTROOM_HOME'] = dir
  const db = getDb()
  // Start from a clean slate (drop the first-run seed) for deterministic fixtures.
  db.exec(`
    DELETE FROM agent_runs; DELETE FROM tool_calls; DELETE FROM pinned_items;
    DELETE FROM agent_memory; DELETE FROM messages; DELETE FROM room_members;
    DELETE FROM files; DELETE FROM user_credentials; DELETE FROM user_profile;
    DELETE FROM agents; DELETE FROM rooms;
  `)
  return {
    db,
    dir,
    cleanup() {
      closeDb()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

type Row = Record<string, unknown>
type Db = ReturnType<typeof getDb>

function insertRow(db: Db, table: string, row: Row): string {
  const cols = Object.keys(row)
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  db.prepare(sql).run(...cols.map((c) => row[c]))
  return row['id'] as string
}

/** Insert a room (defaults: a group room owned by the local user). Returns the id. */
export function seedRoom(db: Db, o: Row = {}): string {
  const id = (o['id'] as string) ?? newId()
  return insertRow(db, 'rooms', { id, name: 'Test Room', ...o })
}

/** Insert an agent (defaults: a mock-adapter agent). Returns the id. */
export function seedAgent(db: Db, o: Row = {}): string {
  const id = (o['id'] as string) ?? newId()
  return insertRow(db, 'agents', {
    id,
    name: 'Test Agent',
    slug: `agent_${id.slice(0, 8)}`,
    provider: 'mock',
    adapter_type: 'mock',
    ...o,
  })
}

/** Add an agent (default) or user member to a room. Returns the member id. */
export function seedMember(db: Db, roomId: string, opts: Row = {}): string {
  const id = (opts['id'] as string) ?? newId()
  return insertRow(db, 'room_members', { id, room_id: roomId, member_type: 'agent', ...opts })
}

/** Insert a message (defaults: a user 'hi'). Returns the id. */
export function seedMessage(db: Db, roomId: string, o: Row = {}): string {
  const id = (o['id'] as string) ?? newId()
  return insertRow(db, 'messages', {
    id,
    room_id: roomId,
    sender_type: 'user',
    content: 'hi',
    ...o,
  })
}

/** Insert an agent_run (defaults: queued). Returns the id. */
export function seedRun(db: Db, roomId: string, agentId: string, o: Row = {}): string {
  const id = (o['id'] as string) ?? newId()
  return insertRow(db, 'agent_runs', {
    id,
    room_id: roomId,
    agent_id: agentId,
    status: 'queued',
    ...o,
  })
}
