/**
 * SQLite schema — a local port of the former Supabase/Postgres schema.
 *
 * Porting rules (see PROGRESS decision D3):
 *   - UUIDs are TEXT, generated in JS (crypto.randomUUID).
 *   - Timestamps are ISO-8601 TEXT (default via strftime), lexicographically sortable.
 *   - jsonb  -> TEXT holding JSON (default '{}' / '[]').
 *   - boolean -> INTEGER 0/1.
 *   - numeric -> REAL.
 *   - RLS / GRANTs / auth.users / realtime publication: dropped (single local user,
 *     server-only access). created_by_user_id / sender_user_id etc. are plain TEXT
 *     holding the LOCAL_USER_ID constant (no FK to an auth table).
 *   - The agent_runs status machine + indexes are preserved (it's the work queue).
 *
 * Idempotent: every statement uses IF NOT EXISTS so getDb() can run it on every boot.
 */

const ISO_NOW = `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

export const SCHEMA_SQL = `
-- ----- rooms -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  slug                 TEXT,
  room_type            TEXT NOT NULL DEFAULT 'group',
  reply_mode           TEXT NOT NULL DEFAULT 'everyone',
  max_agent_rounds     INTEGER NOT NULL DEFAULT 3,
  max_agent_hops       INTEGER NOT NULL DEFAULT 6,
  allow_agent_to_agent INTEGER NOT NULL DEFAULT 1,
  discussion_mode      TEXT NOT NULL DEFAULT 'independent',
  visibility           TEXT NOT NULL DEFAULT 'private',
  is_archived          INTEGER NOT NULL DEFAULT 0,
  context_reset_at     TEXT,
  last_message_at      TEXT,
  session_id           TEXT,
  created_by_user_id   TEXT,
  created_at           TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at           TEXT NOT NULL DEFAULT ${ISO_NOW}
);
CREATE INDEX IF NOT EXISTS rooms_last_message_at_idx ON rooms (last_message_at DESC);
-- NOTE: the rooms(session_id) index is created in db.ts applyMigrations(), AFTER the
-- ALTER that adds session_id — an existing DB lacks the column when SCHEMA_SQL runs, so
-- creating the index here would abort the whole schema exec on upgrade.

-- ----- sessions (Cowork-style working contexts; a session has many rooms) ---------
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  working_dir    TEXT NOT NULL,
  created_by_user_id TEXT,
  last_active_at TEXT NOT NULL DEFAULT ${ISO_NOW},
  created_at     TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at     TEXT NOT NULL DEFAULT ${ISO_NOW}
);
CREATE INDEX IF NOT EXISTS sessions_last_active_idx ON sessions (last_active_at DESC);

-- ----- agents ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  avatar_url         TEXT,
  provider           TEXT NOT NULL,
  adapter_type       TEXT NOT NULL DEFAULT 'subprocess',
  model              TEXT,
  system_prompt      TEXT,
  reply_policy       TEXT NOT NULL DEFAULT 'reply_when_invoked',
  tool_permissions   TEXT NOT NULL DEFAULT '{}',
  capabilities       TEXT,
  credential_id      TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT,
  created_at         TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at         TEXT NOT NULL DEFAULT ${ISO_NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_owner_slug_unique ON agents (created_by_user_id, slug);
CREATE INDEX IF NOT EXISTS agents_provider_idx ON agents (provider);
CREATE INDEX IF NOT EXISTS agents_active_idx ON agents (is_active);

-- ----- room_members ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_members (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  member_type   TEXT NOT NULL,
  user_id       TEXT,
  agent_id      TEXT REFERENCES agents (id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member',
  reply_enabled INTEGER NOT NULL DEFAULT 1,
  muted         INTEGER NOT NULL DEFAULT 0,
  joined_at     TEXT NOT NULL DEFAULT ${ISO_NOW},
  created_at    TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at    TEXT NOT NULL DEFAULT ${ISO_NOW},
  CHECK (
    (member_type = 'user'  AND user_id  IS NOT NULL AND agent_id IS NULL) OR
    (member_type = 'agent' AND agent_id IS NOT NULL AND user_id  IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS room_members_user_unique  ON room_members (room_id, user_id)  WHERE user_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS room_members_agent_unique ON room_members (room_id, agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS room_members_room_idx  ON room_members (room_id);
CREATE INDEX IF NOT EXISTS room_members_agent_idx ON room_members (agent_id);

-- ----- messages --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  room_id          TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  sender_type      TEXT NOT NULL,
  sender_user_id   TEXT,
  sender_agent_id  TEXT REFERENCES agents (id) ON DELETE SET NULL,
  content          TEXT NOT NULL DEFAULT '',
  content_type     TEXT NOT NULL DEFAULT 'text',
  reply_to_id      TEXT,
  thread_id        TEXT,
  mentions         TEXT NOT NULL DEFAULT '[]',
  target_agent_ids TEXT NOT NULL DEFAULT '[]',
  round_index      INTEGER NOT NULL DEFAULT 0,
  is_partial       INTEGER NOT NULL DEFAULT 0,
  metadata         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at       TEXT NOT NULL DEFAULT ${ISO_NOW}
);
CREATE INDEX IF NOT EXISTS messages_room_created_idx ON messages (room_id, created_at);
CREATE INDEX IF NOT EXISTS messages_room_turn_idx    ON messages (room_id, round_index);
CREATE INDEX IF NOT EXISTS messages_thread_idx       ON messages (thread_id) WHERE thread_id IS NOT NULL;

-- ----- agent_runs (the work queue) -------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
  id                   TEXT PRIMARY KEY,
  room_id              TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  agent_id             TEXT NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  trigger_msg_id       TEXT,
  status               TEXT NOT NULL DEFAULT 'queued',
  round_index          INTEGER NOT NULL DEFAULT 0,
  error_message        TEXT,
  partial_content      TEXT,
  worker_id            TEXT,
  heartbeat_at         TEXT,
  started_at           TEXT,
  completed_at         TEXT,
  discussion_mode      TEXT NOT NULL DEFAULT 'independent',
  deliberation_depth   INTEGER NOT NULL DEFAULT 0,
  deliberation_root_id TEXT,
  created_at           TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at           TEXT NOT NULL DEFAULT ${ISO_NOW}
);
CREATE INDEX IF NOT EXISTS agent_runs_status_created_idx ON agent_runs (status, created_at);
CREATE INDEX IF NOT EXISTS agent_runs_room_turn_idx      ON agent_runs (room_id, round_index);
CREATE INDEX IF NOT EXISTS agent_runs_trigger_idx        ON agent_runs (trigger_msg_id) WHERE trigger_msg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_runs_agent_idx          ON agent_runs (agent_id);
CREATE INDEX IF NOT EXISTS agent_runs_heartbeat_idx      ON agent_runs (heartbeat_at) WHERE heartbeat_at IS NOT NULL;

-- ----- tool_calls ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_calls (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  room_id           TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  agent_id          TEXT,
  tool_name         TEXT NOT NULL,
  tool_category     TEXT,
  input_args        TEXT NOT NULL DEFAULT '{}',
  output            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  requires_approval INTEGER NOT NULL DEFAULT 1,
  error             TEXT,
  approved_by       TEXT,
  approved_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at        TEXT NOT NULL DEFAULT ${ISO_NOW}
);
CREATE INDEX IF NOT EXISTS tool_calls_room_idx ON tool_calls (room_id);
CREATE INDEX IF NOT EXISTS tool_calls_run_idx  ON tool_calls (run_id);

-- ----- files -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id               TEXT PRIMARY KEY,
  room_id          TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  uploader_user_id TEXT,
  filename         TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL DEFAULT 0,
  storage_path     TEXT NOT NULL,
  storage_bucket   TEXT NOT NULL DEFAULT 'local',
  message_id       TEXT,
  metadata         TEXT NOT NULL DEFAULT '{}',
  extracted_text   TEXT,
  created_at       TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at       TEXT NOT NULL DEFAULT ${ISO_NOW}
);
CREATE INDEX IF NOT EXISTS files_room_idx    ON files (room_id);
CREATE INDEX IF NOT EXISTS files_message_idx ON files (message_id) WHERE message_id IS NOT NULL;

-- ----- pinned_items ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS pinned_items (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  message_id  TEXT REFERENCES messages (id) ON DELETE CASCADE,
  pinned_by   TEXT,
  note        TEXT,
  pin_type    TEXT NOT NULL DEFAULT 'context',
  title       TEXT,
  content     TEXT,
  visibility  TEXT NOT NULL DEFAULT 'primary',
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at  TEXT NOT NULL DEFAULT ${ISO_NOW}
);
CREATE INDEX IF NOT EXISTS pinned_items_room_idx ON pinned_items (room_id, is_active);

-- ----- agent_memory ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_memory (
  id                 TEXT PRIMARY KEY,
  agent_id           TEXT REFERENCES agents (id) ON DELETE CASCADE,
  room_id            TEXT REFERENCES rooms (id) ON DELETE CASCADE,
  scope              TEXT NOT NULL DEFAULT 'room',
  kind               TEXT NOT NULL DEFAULT 'fact',
  title              TEXT,
  content            TEXT NOT NULL,
  source_message_id  TEXT,
  created_by_user_id TEXT,
  confidence         REAL NOT NULL DEFAULT 0.5,
  pinned             INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1,
  injection_flagged  INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at         TEXT NOT NULL DEFAULT ${ISO_NOW}
);
CREATE INDEX IF NOT EXISTS agent_memory_room_active_idx ON agent_memory (room_id, is_active) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS agent_memory_agent_idx       ON agent_memory (agent_id) WHERE agent_id IS NOT NULL;

-- ----- user_profile ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profile (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL UNIQUE,
  summary    TEXT,
  details    TEXT NOT NULL DEFAULT '{}',
  consented  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at TEXT NOT NULL DEFAULT ${ISO_NOW}
);

-- ----- user_credentials (optional BYO per-profile env; CLI auth normally deferred) -
CREATE TABLE IF NOT EXISTS user_credentials (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  provider          TEXT NOT NULL,
  label             TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  secret_nonce      TEXT NOT NULL,
  base_url          TEXT,
  is_default        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT ${ISO_NOW},
  updated_at        TEXT NOT NULL DEFAULT ${ISO_NOW}
);
CREATE INDEX IF NOT EXISTS user_credentials_user_idx ON user_credentials (user_id);

-- ----- updated_at triggers (replace the Postgres set_updated_at() trigger) ----
CREATE TRIGGER IF NOT EXISTS rooms_set_updated_at        AFTER UPDATE ON rooms        FOR EACH ROW BEGIN UPDATE rooms        SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS sessions_set_updated_at     AFTER UPDATE ON sessions     FOR EACH ROW BEGIN UPDATE sessions     SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS agents_set_updated_at       AFTER UPDATE ON agents       FOR EACH ROW BEGIN UPDATE agents       SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS room_members_set_updated_at AFTER UPDATE ON room_members FOR EACH ROW BEGIN UPDATE room_members SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS messages_set_updated_at     AFTER UPDATE ON messages     FOR EACH ROW BEGIN UPDATE messages     SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS agent_runs_set_updated_at   AFTER UPDATE ON agent_runs   FOR EACH ROW BEGIN UPDATE agent_runs   SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS tool_calls_set_updated_at   AFTER UPDATE ON tool_calls   FOR EACH ROW BEGIN UPDATE tool_calls   SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS files_set_updated_at        AFTER UPDATE ON files        FOR EACH ROW BEGIN UPDATE files        SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS pinned_items_set_updated_at AFTER UPDATE ON pinned_items FOR EACH ROW BEGIN UPDATE pinned_items SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS agent_memory_set_updated_at AFTER UPDATE ON agent_memory FOR EACH ROW BEGIN UPDATE agent_memory SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS user_profile_set_updated_at AFTER UPDATE ON user_profile FOR EACH ROW BEGIN UPDATE user_profile SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS user_credentials_set_updated_at AFTER UPDATE ON user_credentials FOR EACH ROW BEGIN UPDATE user_credentials SET updated_at = ${ISO_NOW} WHERE id = NEW.id; END;
`
