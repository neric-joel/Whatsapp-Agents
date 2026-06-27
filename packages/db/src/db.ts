import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

import { newId } from './ids.js'
import { dbPath, ensureAppDirs } from './paths.js'
import { SCHEMA_SQL } from './schema.js'

/**
 * The single local user. There are no accounts — one person, one machine — so a
 * fixed id owns everything. Columns that used to FK auth.users (created_by_user_id,
 * sender_user_id, pinned_by, ...) just hold this string.
 */
export const LOCAL_USER_ID = '00000000-0000-0000-0000-0000000000a1'
export const LOCAL_USER = { id: LOCAL_USER_ID, name: 'You' } as const

let _db: Database.Database | null = null

/**
 * Open (or create) the local SQLite database, ensure the schema exists, seed a
 * first room on a fresh install, and return a process-wide singleton. Safe to
 * call from both the Next.js server and the bridge daemon (WAL mode lets them
 * share the file).
 */
export function getDb(): Database.Database {
  if (_db) return _db

  const file = dbPath()
  mkdirSync(dirname(file), { recursive: true })
  try {
    ensureAppDirs()
  } catch {
    // best-effort; the files/ dir is only needed once attachments are used
  }

  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.exec(SCHEMA_SQL)
  applyMigrations(db)
  seedIfEmpty(db)

  _db = db
  return db
}

/**
 * Additive column migrations for DBs created before a column existed. SCHEMA_SQL uses
 * CREATE TABLE IF NOT EXISTS, which does NOT add new columns to an existing table — so
 * pre-existing local DBs need an explicit ADD COLUMN. Each is guarded: a duplicate-column
 * error means it's already applied (idempotent, safe on every boot).
 */
function applyMigrations(db: Database.Database): void {
  const addColumn = (sql: string) => {
    try {
      db.exec(sql)
    } catch (e) {
      if (!/duplicate column name/i.test(e instanceof Error ? e.message : String(e))) throw e
    }
  }
  addColumn('ALTER TABLE rooms ADD COLUMN session_id TEXT')
  // Safe now that session_id exists (fresh DBs: the CREATE TABLE already has it).
  db.exec(
    'CREATE INDEX IF NOT EXISTS rooms_session_idx ON rooms (session_id) WHERE session_id IS NOT NULL',
  )
}

/** Close the singleton (tests). */
export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

/**
 * Seed a first room with the three built-in agents on a brand-new install,
 * mirroring the old supabase/seed.sql. No-op once any room exists.
 */
function seedIfEmpty(db: Database.Database): void {
  const { c } = db.prepare('SELECT count(*) AS c FROM rooms').get() as { c: number }
  if (c > 0) return

  const seed = db.transaction(() => {
    const agents: Array<{
      id: string
      name: string
      slug: string
      provider: string
      adapter: string
    }> = [
      {
        id: newId(),
        name: 'Claude Thinker',
        slug: 'claude_thinker',
        provider: 'claude_code',
        adapter: 'claude-code',
      },
      {
        id: newId(),
        name: 'Codex Builder',
        slug: 'codex_builder',
        provider: 'codex_cli',
        adapter: 'codex-cli',
      },
      { id: newId(), name: 'Reviewer', slug: 'reviewer', provider: 'mock', adapter: 'mock' },
    ]
    const insertAgent = db.prepare(
      `INSERT INTO agents (id, name, slug, provider, adapter_type, reply_policy, is_active, created_by_user_id)
       VALUES (@id, @name, @slug, @provider, @adapter, 'reply_when_invoked', 1, @owner)`,
    )
    for (const a of agents) insertAgent.run({ ...a, owner: LOCAL_USER_ID })

    const roomId = newId()
    db.prepare(
      `INSERT INTO rooms (id, name, room_type, reply_mode, max_agent_rounds, max_agent_hops, allow_agent_to_agent, visibility, created_by_user_id)
       VALUES (@id, 'My First AgentRoom', 'group', 'everyone', 3, 6, 1, 'private', @owner)`,
    ).run({ id: roomId, owner: LOCAL_USER_ID })

    const insertMember = db.prepare(
      `INSERT INTO room_members (id, room_id, member_type, agent_id, role, reply_enabled, muted)
       VALUES (@id, @room, 'agent', @agent, 'member', 1, 0)`,
    )
    for (const a of agents) insertMember.run({ id: newId(), room: roomId, agent: a.id })
  })

  seed()
}
