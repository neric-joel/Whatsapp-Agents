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
 * Seed an EMPTY starter room on a brand-new install — a place to land — but NO
 * pre-built agents (v2 "select your agents" rule: the user picks which connected CLIs
 * join, like choosing a car before a race; nothing is forced on them). No-op once any
 * room exists.
 */
function seedIfEmpty(db: Database.Database): void {
  const { c } = db.prepare('SELECT count(*) AS c FROM rooms').get() as { c: number }
  if (c > 0) return

  db.prepare(
    `INSERT INTO rooms (id, name, room_type, reply_mode, max_agent_rounds, max_agent_hops, allow_agent_to_agent, visibility, created_by_user_id)
     VALUES (@id, 'My First AgentRoom', 'group', 'everyone', 3, 6, 1, 'private', @owner)`,
  ).run({ id: newId(), owner: LOCAL_USER_ID })
}
