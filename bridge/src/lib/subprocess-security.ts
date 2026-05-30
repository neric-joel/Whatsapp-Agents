import { existsSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

/**
 * Security helpers for spawning agent CLIs.
 *
 * Threat model: an agent's `system_prompt` and message content are attacker-
 * influenced (any room admin can set them; messages come from users). The bridge
 * runs real CLIs on the host, so the rules are:
 *   1. Never spawn through a shell (`shell:false`) — no string is ever re-parsed
 *      by cmd.exe / sh, so there is no command-injection surface.
 *   2. The binary is resolved to an absolute path from a trusted source (an
 *      explicit *_BIN env var, or a PATH lookup) — never from agent data.
 *   3. The child environment is allowlisted — secrets (the Supabase service-role
 *      key, bridge config) are never forwarded to a child process.
 */

export class BinaryNotFoundError extends Error {
  constructor(public readonly command: string) {
    super(`Binary not found: ${command}`)
    this.name = 'BinaryNotFoundError'
  }
}

/** Env var names that must NEVER reach a child process. */
const SECRET_ENV_PATTERN = /(SUPABASE|SERVICE_ROLE|SECRET|PASSWORD|PRIVATE_KEY|^BRIDGE_|_TOKEN$|^TOKEN$)/i

/** Base, non-secret environment a CLI needs to run on Windows/POSIX. */
const BASE_ENV_KEYS = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'COMSPEC',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'HOMEPATH', 'HOMEDRIVE', 'USERPROFILE', 'USERNAME',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'NODE_EXTRA_CA_CERTS', 'SHELL',
]

/** Provider auth the agent CLIs legitimately read from the environment. */
const PROVIDER_ENV_PATTERN = /^(ANTHROPIC_|CLAUDE_CODE_|OPENAI_|CODEX_|RUFLO_|AWS_|AZURE_|GOOGLE_|GEMINI_|VERTEX_)/i

/**
 * Build a minimal, allowlisted environment for a child agent CLI. Secrets are
 * stripped unconditionally; self-hosters can forward extra vars via
 * `BRIDGE_CHILD_ENV_ALLOW` (comma-separated names).
 */
export function buildChildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const extra = (source['BRIDGE_CHILD_ENV_ALLOW'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const allow = new Set([...BASE_ENV_KEYS, ...extra])

  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (SECRET_ENV_PATTERN.test(key)) continue // never forward secrets
    if (allow.has(key) || PROVIDER_ENV_PATTERN.test(key)) out[key] = value
  }
  return out
}

/**
 * Resolve a configured command to an absolute path. The command comes from a
 * trusted *_BIN env var (or its default), never from agent data.
 *
 * - An absolute / path-containing command is validated to exist and be a file.
 * - A bare command is resolved against PATH (with PATHEXT on Windows).
 *
 * Throws {@link BinaryNotFoundError} if it cannot be resolved.
 */
export function resolveBinaryPath(command: string, source: NodeJS.ProcessEnv = process.env): string {
  const isFile = (p: string): boolean => {
    try {
      return existsSync(p) && statSync(p).isFile()
    } catch {
      return false
    }
  }

  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    if (isFile(command)) return command
    throw new BinaryNotFoundError(command)
  }

  const pathVar = source['PATH'] ?? source['Path'] ?? ''
  const dirs = pathVar.split(delimiter).filter(Boolean)
  const exts = process.platform === 'win32'
    ? (source['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim()).filter(Boolean)
    : ['']

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext)
      if (isFile(candidate)) return candidate
    }
  }

  throw new BinaryNotFoundError(command)
}

/**
 * Decide how to spawn a resolved binary with `shell:false`.
 *
 * Node refuses to execute a Windows `.cmd`/`.bat` shim without a shell (EINVAL,
 * post-CVE-2024-27980). We route those through `cmd.exe /d /s /c` — but every
 * argument is a static, code-defined constant (no agent/user data ever reaches
 * argv, since prompts go via stdin), so there is no injection surface.
 */
export function resolveSpawnTarget(
  binPath: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  source: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(binPath)) {
    const comspec = source['COMSPEC'] || 'cmd.exe'
    return { command: comspec, args: ['/d', '/s', '/c', binPath, ...args] }
  }
  return { command: binPath, args: [...args] }
}
