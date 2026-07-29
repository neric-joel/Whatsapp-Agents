import { existsSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

import { buildWindowsCmdCommandLine, needsWindowsCmdCommandLine } from '@agentroom/shared'

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
 *   3. The child environment is allowlisted, and anything matching
 *      SECRET_ENV_PATTERN is denied before the allowlist is consulted, so no secret
 *      in the bridge's own environment reaches a child. That regex, defined below,
 *      is the single source of truth for which names are secret — deliberately not
 *      restated here, because every restatement is one more thing to drift. A
 *      legitimate provider key reaches exactly one child through the per-run
 *      `inject` seam instead (ADR-0010), never through the environment.
 */

export class BinaryNotFoundError extends Error {
  constructor(public readonly command: string) {
    super(`Binary not found: ${command}`)
    this.name = 'BinaryNotFoundError'
  }
}

/**
 * Env var names that must NEVER reach a child process. Tested BEFORE the allowlist, so
 * a match is an unconditional deny that `BRIDGE_CHILD_ENV_ALLOW` cannot override.
 *
 * The credential clauses deliberately outrank PROVIDER_ENV_PATTERN below: an
 * `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` sitting in the bridge's own environment is a
 * host-wide credential that would otherwise be handed to EVERY spawned CLI, including a
 * user-configured profile whose `bin` is any path on disk. Per-agent provider keys have
 * their own path (the `inject` seam), and a CLI profile can still opt one in explicitly
 * via its own `env`.
 *
 * `CREDENTIAL` and `APIKEY` are unanchored, like `SECRET` and `PASSWORD`, because the
 * anchored forms missed real credentials: `^CREDENTIAL_` never matched
 * `GOOGLE_APPLICATION_CREDENTIALS` (a path to a service-account file holding a private
 * key), and `_KEY$` never matched `OPENAI_APIKEY`, which has no underscore.
 */
const SECRET_ENV_PATTERN =
  /(SUPABASE|SERVICE_ROLE|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|APIKEY|^BRIDGE_|_TOKEN$|^TOKEN$|_KEY$)/i

/** Base, non-secret environment a CLI needs to run on Windows/POSIX. */
const BASE_ENV_KEYS = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'HOMEPATH',
  'HOMEDRIVE',
  'USERPROFILE',
  'USERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'NODE_EXTRA_CA_CERTS',
  'SHELL',
]

/**
 * Provider configuration the agent CLIs legitimately read from the environment —
 * endpoints, regions, model and profile selectors (`ANTHROPIC_BASE_URL`,
 * `AWS_REGION`, `OPENAI_VISION_MODEL`, …). SECRET_ENV_PATTERN is applied first, so a
 * provider-prefixed name ending in `_KEY` is denied despite matching here.
 */
const PROVIDER_ENV_PATTERN =
  /^(ANTHROPIC_|CLAUDE_CODE_|OPENAI_|CODEX_|AWS_|AZURE_|GOOGLE_|GEMINI_|VERTEX_)/i

/**
 * Build a minimal, allowlisted environment for a child agent CLI. Secrets are
 * stripped unconditionally — BEFORE the allowlist is consulted, so naming one in
 * `BRIDGE_CHILD_ENV_ALLOW` (comma-separated names) does not forward it.
 */
interface ChildEnvOptions {
  /**
   * BYO-credential injection (ADR-0010 / WS2). Exactly one resolved credential var
   * is set into THIS child's env — applied AFTER the strip/allowlist, so a secret
   * resolved per-run reaches only the chosen child's chosen variable while
   * `process.env` secrets stay stripped. The decrypted value is never logged and is
   * computed out-of-band (never via the stdin packet). The name must be a valid env
   * identifier; an invalid name is ignored (fail-closed, no injection).
   */
  inject?: { name: string; value: string }
  /**
   * Platform override used by tests. Runtime callers use the host platform.
   */
  platform?: NodeJS.Platform
}

const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/

function normalizeEnvName(name: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? name.toUpperCase() : name
}

function envValue(
  source: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== 'win32') return source[name]
  const normalized = name.toUpperCase()
  for (const [key, value] of Object.entries(source)) {
    if (key.toUpperCase() === normalized) return value
  }
  return undefined
}

export function buildChildEnv(
  source: NodeJS.ProcessEnv = process.env,
  options: ChildEnvOptions = {},
): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform
  const extra = (envValue(source, 'BRIDGE_CHILD_ENV_ALLOW', platform) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const allow = new Set([...BASE_ENV_KEYS, ...extra].map((key) => normalizeEnvName(key, platform)))

  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (SECRET_ENV_PATTERN.test(key)) continue // never forward secrets
    if (allow.has(normalizeEnvName(key, platform)) || PROVIDER_ENV_PATTERN.test(key)) {
      out[key] = value
    }
  }

  // Deliberate single-var injection of a resolved BYO credential — the ONLY way a
  // user secret enters a child env. Overrides the strip for exactly this one var,
  // in this one child, for this one run.
  const inj = options.inject
  if (inj && ENV_NAME_RE.test(inj.name)) {
    out[inj.name] = inj.value
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
export function resolveBinaryPath(
  command: string,
  source: NodeJS.ProcessEnv = process.env,
): string {
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
  const exts =
    process.platform === 'win32'
      ? (source['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((e) => e.trim())
          .filter(Boolean)
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
 * post-CVE-2024-27980). We route those through `cmd.exe /d /s /c`. Simple tokens
 * use Node's default cmd.exe arg escaping. Tokens that contain spaces or cmd
 * metacharacters are packed into one escaped `/c` command string and spawned with
 * `windowsVerbatimArguments`, so `cmd /s` cannot strip path quotes into an
 * unquoted `C:\Program Files\...` command and metachar-looking args stay data.
 * The args may be user-configured (a connected CLI profile's `args`), but they are
 * NOT attacker-influenced: no message / system_prompt / packet data ever reaches
 * argv (the prompt goes via stdin).
 */
export function resolveSpawnTarget(
  binPath: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  source: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(binPath)) {
    const comspec = source['COMSPEC'] || 'cmd.exe'
    if (!needsWindowsCmdCommandLine(binPath, args)) {
      return { command: comspec, args: ['/d', '/s', '/c', binPath, ...args] }
    }
    return {
      command: comspec,
      args: ['/d', '/s', '/c', buildWindowsCmdCommandLine(binPath, args)],
      windowsVerbatimArguments: true,
    }
  }
  return { command: binPath, args: [...args] }
}
