/**
 * CLI auto-detection for the Connections screen.
 *
 * Probes the system PATH for known agent CLIs and reports, for each, whether the
 * binary is present and whether `--version` runs cleanly. AgentRoom does NOT try to
 * detect or manage a CLI's login — auth is the CLI's own job (see
 * docs/CONNECTING_CLIS.md). Each catalog entry carries an `authHint` the UI shows so
 * a user who isn't logged in knows exactly what to run; a genuinely unauthenticated
 * CLI also surfaces its own auth error at first real use (the run is marked failed,
 * never silently hung).
 *
 * Server-only (spawns child processes + reads PATH). Used by the web API.
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

import type { CliKind } from './config.js'

/** A known CLI AgentRoom can auto-detect and connect with sensible defaults. */
export interface KnownCli {
  key: string
  name: string
  /** Default @mention handle. */
  slug: string
  /** Bare command probed against PATH (and the default profile bin). */
  command: string
  /** Default argv used when this CLI is added to a room. */
  defaultArgs: string[]
  kind: CliKind
  /** Plain-language note on how this CLI authenticates (auth is the CLI's job). */
  authHint: string
}

export const KNOWN_CLIS: KnownCli[] = [
  {
    key: 'claude-code',
    name: 'Claude Code',
    slug: 'claude',
    command: 'claude',
    defaultArgs: ['--print', '--output-format', 'json'],
    kind: 'claude-code',
    authHint:
      'Uses your existing Claude Code login (Claude subscription or ANTHROPIC_API_KEY). If replies fail with an auth error, run `claude login` in your terminal.',
  },
  {
    key: 'codex',
    name: 'Codex',
    slug: 'codex',
    command: 'codex',
    defaultArgs: ['exec', '--json', '-'],
    kind: 'codex-cli',
    authHint:
      'Uses your existing Codex login (ChatGPT sign-in or OPENAI_API_KEY). If replies fail with an auth error, run `codex login` in your terminal.',
  },
  {
    key: 'gemini',
    name: 'Gemini CLI',
    slug: 'gemini',
    command: 'gemini',
    defaultArgs: ['--prompt', '-'],
    kind: 'generic',
    authHint:
      'Uses your existing Gemini CLI login (run `gemini` once to authenticate, or set GEMINI_API_KEY).',
  },
  {
    key: 'antigravity',
    name: 'Antigravity',
    slug: 'antigravity',
    command: 'antigravity',
    defaultArgs: [],
    kind: 'generic',
    authHint: 'Uses whatever auth the Antigravity CLI stores itself; AgentRoom asks for no keys.',
  },
]

/** Status of a single CLI probe. */
export type CliProbeStatus = 'ready' | 'error' | 'not_found'

export interface CliProbeResult {
  /** Resolved absolute path, or null if not on PATH. */
  path: string | null
  status: CliProbeStatus
  /** Trimmed first line of `--version` output, when available. */
  version: string | null
  /** Human-readable detail when status is 'error' (e.g. why --version failed). */
  detail: string | null
}

export interface DetectedCli extends KnownCli, CliProbeResult {}

const isFile = (p: string): boolean => {
  try {
    return existsSync(p) && statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve a command to an absolute path against PATH (+ PATHEXT on Windows).
 * Mirrors the bridge's spawn-time `resolveBinaryPath` so the Connections screen
 * reports exactly what the bridge will later be able to spawn. Returns null if the
 * command can't be found.
 */
export function whichBinary(
  command: string,
  source: NodeJS.ProcessEnv = process.env,
): string | null {
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return isFile(command) ? command : null
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
  return null
}

interface ProbeOutput {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError: string | null
}

/**
 * Decide how to spawn a resolved binary with `shell:false`. Node refuses to execute a
 * Windows `.cmd`/`.bat` shim without a shell (EINVAL, post-CVE-2024-27980), so route
 * those through `cmd.exe /d /s /c` — mirrors the bridge's resolveSpawnTarget. Every arg
 * here is a static, code-defined constant, so there is no injection surface.
 */
export function spawnTarget(
  bin: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  source: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    const comspec = source['COMSPEC'] || 'cmd.exe'
    return { command: comspec, args: ['/d', '/s', '/c', bin, ...args] }
  }
  return { command: bin, args }
}

/** Run `<bin> <args>` with a short timeout, capturing output. Never throws. */
function runProbe(bin: string, args: string[], timeoutMs = 8000): Promise<ProbeOutput> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (o: ProbeOutput) => {
      if (settled) return
      settled = true
      resolve(o)
    }
    const target = spawnTarget(bin, args)
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(target.command, target.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
    } catch (e) {
      finish({ code: null, stdout: '', stderr: '', timedOut: false, spawnError: String(e) })
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* best effort */
      }
      finish({ code: null, stdout, stderr, timedOut: true, spawnError: null })
    }, timeoutMs)
    child.stdout?.on('data', (d) => {
      stdout += String(d)
      if (stdout.length > 8192) stdout = stdout.slice(0, 8192)
    })
    child.stderr?.on('data', (d) => {
      stderr += String(d)
      if (stderr.length > 8192) stderr = stderr.slice(0, 8192)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      finish({ code: null, stdout, stderr, timedOut: false, spawnError: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ code, stdout, stderr, timedOut: false, spawnError: null })
    })
  })
}

const firstLine = (s: string): string | null => {
  const line = s.split(/\r?\n/).find((l) => l.trim().length > 0)
  return line ? line.trim().slice(0, 200) : null
}

/**
 * Probe one command: is it on PATH, and does a version flag run cleanly?
 * `versionArgs` defaults to ['--version']; pass [] to only check presence.
 */
export async function probeCommand(
  command: string,
  versionArgs: string[] = ['--version'],
): Promise<CliProbeResult> {
  const path = whichBinary(command)
  if (!path) return { path: null, status: 'not_found', version: null, detail: null }
  if (versionArgs.length === 0) {
    return { path, status: 'ready', version: null, detail: null }
  }
  const out = await runProbe(path, versionArgs)
  if (out.spawnError) {
    return { path, status: 'error', version: null, detail: out.spawnError }
  }
  if (out.timedOut) {
    return { path, status: 'error', version: null, detail: 'version probe timed out' }
  }
  if (out.code !== 0) {
    const detail = firstLine(out.stderr) ?? firstLine(out.stdout) ?? `exit code ${out.code}`
    return { path, status: 'error', version: null, detail }
  }
  return {
    path,
    status: 'ready',
    version: firstLine(out.stdout) ?? firstLine(out.stderr),
    detail: null,
  }
}

/** Detect every known CLI in parallel. */
export async function detectKnownClis(): Promise<DetectedCli[]> {
  return Promise.all(
    KNOWN_CLIS.map(async (cli) => ({ ...cli, ...(await probeCommand(cli.command)) })),
  )
}
