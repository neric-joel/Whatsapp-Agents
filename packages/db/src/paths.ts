import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Local app-data layout (single-user desktop tool). Everything lives on disk,
 * resumable across restarts:
 *
 *   <appDataDir>/
 *     agentroom.db    SQLite (rooms, messages, agents, agent_runs, ...)
 *     files/          uploads & pasted screenshots
 *     config.json     connected CLI profiles + their bin paths
 *
 * Default location: %APPDATA%\AgentRoom on Windows, else ~/.agentroom.
 * Override the whole directory with AGENTROOM_HOME (handy for tests/CI).
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

/** Create the app-data + files directories if they don't exist. Idempotent. */
export function ensureAppDirs(): void {
  mkdirSync(appDataDir(), { recursive: true })
  mkdirSync(filesDir(), { recursive: true })
}
