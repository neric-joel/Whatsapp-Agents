/**
 * Connected-CLI profiles — the `config.json` layer of the local app-data home.
 *
 * AgentRoom never manages a CLI's login: a profile only records WHERE the binary
 * is and HOW to invoke it. At run time the bridge spawns that binary, which uses
 * whatever auth the CLI already stored on disk. `env` is optional and exists only
 * for the rare CLI that needs an extra variable — the default is to defer entirely
 * to the CLI's own config (see docs/CONNECTING_CLIS.md).
 *
 * Stored at <appDataDir>/config.json. Read by the web API (Connections screen) and
 * by the bridge (CliProfileAdapter) — both server-side.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { newId } from './ids.js'
import { configPath, tightenPermissions } from './paths.js'

/** How the bridge should talk to a CLI's stdout (which output parser to use). */
export type CliKind = 'claude-code' | 'codex-cli' | 'generic'

export interface CliProfile {
  /** Stable id; also stored on the agent row (`provider`) to link agent → profile. */
  id: string
  /** Display name, e.g. "Claude Code". */
  name: string
  /** Default @mention handle (lowercase). */
  slug: string
  /** Binary path or bare command resolved against PATH. */
  bin: string
  /** Static argv template passed to the binary. */
  args: string[]
  /** Optional per-profile env (default: none — auth is deferred to the CLI). */
  env?: Record<string, string>
  /** Output dialect: known CLIs get a tailored parser; custom CLIs use 'generic'. */
  kind: CliKind
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface AppConfig {
  version: 1
  clis: CliProfile[]
}

/** The on-disk config schema version. Centralized so every write uses one source. */
const CONFIG_VERSION = 1 as const

const EMPTY_CONFIG: AppConfig = { version: CONFIG_VERSION, clis: [] }

function isCliKind(v: unknown): v is CliKind {
  return v === 'claude-code' || v === 'codex-cli' || v === 'generic'
}

/**
 * One-time arg repair for gemini profiles created from the pre-v1.4.2 catalog.
 * The old defaultArgs `['--prompt', '-']` sent a stray literal `-` to the model on
 * every reply (gemini appends the --prompt value to the stdin input). Profiles
 * snapshot catalog args at connect time, so stored configs keep the bug forever
 * without this rewrite. Applied on every read (idempotent, in-memory); matches
 * ONLY the exact old catalog snapshot so a deliberate custom `-` arg on a
 * differently-named profile is untouched.
 */
function repairLegacyGeminiArgs(slug: string, args: string[]): string[] {
  if (slug === 'gemini' && args.length === 2 && args[0] === '--prompt' && args[1] === '-') {
    return ['--prompt', 'Reply to the conversation above.']
  }
  return args
}

/** Coerce an unknown parsed object into a valid AppConfig, dropping junk entries. */
function normalize(raw: unknown): AppConfig {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CONFIG }
  const obj = raw as Record<string, unknown>
  const clis = Array.isArray(obj.clis) ? obj.clis : []
  const out: CliProfile[] = []
  for (const item of clis) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    if (typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.bin !== 'string') {
      continue
    }
    const slug = typeof p.slug === 'string' ? p.slug : p.id
    const args = Array.isArray(p.args)
      ? p.args.filter((a): a is string => typeof a === 'string')
      : []
    out.push({
      id: p.id,
      name: p.name,
      slug,
      bin: p.bin,
      args: repairLegacyGeminiArgs(slug, args),
      ...(p.env && typeof p.env === 'object' && !Array.isArray(p.env)
        ? { env: p.env as Record<string, string> }
        : {}),
      kind: isCliKind(p.kind) ? p.kind : 'generic',
      enabled: p.enabled !== false,
      created_at: typeof p.created_at === 'string' ? p.created_at : new Date(0).toISOString(),
      updated_at: typeof p.updated_at === 'string' ? p.updated_at : new Date(0).toISOString(),
    })
  }
  return { version: CONFIG_VERSION, clis: out }
}

/**
 * Read config.json. Returns an empty config if the file is missing or corrupt.
 * `env` can hold a plaintext provider secret (the connections API accepts an
 * arbitrary per-profile env map), so on every read we also best-effort tighten an
 * already-existing file that predates this hardening (e.g. left 0644 by an older
 * install) — see `tightenPermissions`. That call is cheap relative to the read+parse
 * below, so there's no need to gate it to "once per process".
 */
export function readConfig(): AppConfig {
  tightenPermissions(configPath(), 0o600)
  try {
    const text = readFileSync(configPath(), 'utf8')
    return normalize(JSON.parse(text))
  } catch {
    return { ...EMPTY_CONFIG, clis: [] }
  }
}

/**
 * Write config.json atomically (write temp + rename), creating the dir if needed.
 * The temp file is created 0600 — `renameSync` preserves the source file's mode, so
 * setting it on the destination AFTER the rename would leave a race window where
 * config.json is briefly at the umask default; setting it on the temp file instead
 * means the file is never observably more permissive than 0600.
 */
export function writeConfig(config: AppConfig): void {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = join(dirname(path), `.config.${newId()}.tmp`)
  writeFileSync(tmp, JSON.stringify({ version: CONFIG_VERSION, clis: config.clis }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
  renameSync(tmp, path)
}

export function listProfiles(): CliProfile[] {
  return readConfig().clis
}

export function getProfile(id: string): CliProfile | undefined {
  return readConfig().clis.find((p) => p.id === id)
}

/**
 * Insert or update a profile (matched by id). Returns the saved profile. Stamps
 * created_at/updated_at; the caller supplies everything else.
 */
export function upsertProfile(
  input: Omit<CliProfile, 'id' | 'created_at' | 'updated_at'> & { id?: string },
): CliProfile {
  const config = readConfig()
  const now = new Date().toISOString()
  const existingIndex = input.id ? config.clis.findIndex((p) => p.id === input.id) : -1

  if (existingIndex >= 0) {
    const prev = config.clis[existingIndex]!
    const updated: CliProfile = {
      ...prev,
      name: input.name,
      slug: input.slug,
      bin: input.bin,
      args: input.args,
      kind: input.kind,
      enabled: input.enabled,
      updated_at: now,
      ...(input.env ? { env: input.env } : {}),
    }
    if (!input.env) delete updated.env
    config.clis[existingIndex] = updated
    writeConfig(config)
    return updated
  }

  const created: CliProfile = {
    id: input.id ?? newId(),
    name: input.name,
    slug: input.slug,
    bin: input.bin,
    args: input.args,
    kind: input.kind,
    enabled: input.enabled,
    created_at: now,
    updated_at: now,
    ...(input.env ? { env: input.env } : {}),
  }
  config.clis.push(created)
  writeConfig(config)
  return created
}

/** Remove a profile by id. Returns true if one was removed. */
export function deleteProfile(id: string): boolean {
  const config = readConfig()
  const next = config.clis.filter((p) => p.id !== id)
  if (next.length === config.clis.length) return false
  writeConfig({ version: CONFIG_VERSION, clis: next })
  return true
}
