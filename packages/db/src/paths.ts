import { chmodSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { createLogger } from '@agentroom/shared'

const logger = createLogger({ base: { component: 'db/paths' } })

/**
 * Local app-data layout (single-user desktop tool). Everything lives on disk,
 * resumable across restarts:
 *
 *   <appDataDir>/
 *     agentroom.db    SQLite (rooms, messages, agents, agent_runs, ...)
 *     files/          uploads & pasted screenshots (0700)
 *     config.json     connected CLI profiles + their bin paths (0600)
 *
 * Default location: %APPDATA%\AgentRoom on Windows, else ~/.agentroom.
 * Override the whole directory with AGENTROOM_HOME (handy for tests/CI).
 *
 * Permissions: the dir and config.json can hold plaintext provider secrets (a
 * connected CLI's per-profile `env`) and agentroom.db holds all room/message
 * content, so everything here is created owner-only (0700/0600) rather than
 * left at the umask default. See `tightenPermissions` below for the
 * already-existing-file upgrade path. No-op in effect on POSIX-mode terms on
 * Windows (chmod there only toggles the read-only attribute) but never throws
 * there either — %APPDATA% ACLs are already per-user.
 */
export function appDataDir(): string {
  const override = process.env['AGENTROOM_HOME']?.trim()
  if (override) return override
  if (process.platform === 'win32') {
    const base = process.env['APPDATA']?.trim() || join(homedir(), 'AppData', 'Roaming')
    return join(base, 'AgentRoom')
  }
  return join(homedir(), '.agentroom')
}

/** Absolute path to the SQLite file. Override directly with AGENTROOM_DB_PATH. */
export function dbPath(): string {
  const override = process.env['AGENTROOM_DB_PATH']?.trim()
  if (override) return override
  return join(appDataDir(), 'agentroom.db')
}

/** Root directory for uploaded/attached files. */
export function filesDir(): string {
  return join(appDataDir(), 'files')
}

/** Path to the connected-CLI profile config. */
export function configPath(): string {
  return join(appDataDir(), 'config.json')
}

/**
 * Best-effort chmod, used both for freshly-created paths (belt-and-suspenders
 * alongside the `mode` passed to mkdirSync/writeFileSync) and to tighten a path that
 * already existed from before this hardening landed (the upgrade path — mkdirSync's
 * `mode` only applies when it actually creates the directory). A failure here
 * (locked file, EPERM, ...) must never block startup, so it's swallowed — but logged
 * at warn (unless the path simply doesn't exist yet, which is normal and not worth
 * a log line) so a real problem isn't hidden.
 */
export function tightenPermissions(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return
    logger.warn('permissions.chmod_failed', {
      path,
      mode: mode.toString(8),
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

/** Create the app-data + files directories if they don't exist. Idempotent. */
export function ensureAppDirs(): void {
  mkdirSync(appDataDir(), { recursive: true, mode: 0o700 })
  mkdirSync(filesDir(), { recursive: true, mode: 0o700 })
  // mkdirSync's `mode` is a no-op if the dir already existed — tighten explicitly so
  // a dir created before this hardening landed gets upgraded on the next boot too.
  tightenPermissions(appDataDir(), 0o700)
  tightenPermissions(filesDir(), 0o700)
}
