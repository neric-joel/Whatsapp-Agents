/**
 * working_dir hardening (issue #67).
 *
 * `sessions.working_dir` is a folder the user "opens" as a Cowork-style working context.
 * Today it is only stored + displayed (inert), but it is destined to become the **cwd of a
 * spawned agent CLI** — a powerful child process. An unvalidated cwd is a path-traversal /
 * arbitrary-directory risk, so every working_dir is validated *before it is stored* and any
 * future code that turns one into a spawn cwd MUST route through `validateWorkingDir` too
 * (see the spawn site in bridge/src/adapters/subprocess-adapter.ts).
 *
 * The rule: an absolute path, no UNC/device paths, whose **realpath** (symlinks resolved,
 * `..` collapsed) is a real directory that lives inside an allow-root. The allow-root
 * defaults to the user's home directory and is overridable with AGENTROOM_WORKSPACE_ROOT —
 * broad enough for the "open any of my project folders" use case, narrow enough to keep the
 * cwd out of system directories and to defeat traversal/symlink escapes. Two extra guards
 * (defense-in-depth, since the default root is all of $HOME): an over-broad root (`/`, a bare
 * drive root, `/home`, `/Users`) is rejected, and the app's own store + credential dirs
 * (`.ssh`, `.aws`, `.gnupg`, `.config`, `~/.agentroom`, …) are never allowed even inside the root.
 */
import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, parse, resolve, sep } from 'node:path'

import { appDataDir } from './paths.js'

export interface WorkingDirResult {
  ok: boolean
  /** On success: the canonical, realpath-resolved absolute directory (use THIS as cwd). */
  path?: string
  /** On failure: a user-safe reason (no internals leaked). */
  reason?: string
}

/**
 * The directory a working_dir must live inside. Defaults to the user's home directory;
 * override with an absolute AGENTROOM_WORKSPACE_ROOT (e.g. projects on another drive).
 */
export function workspaceRoot(): string {
  const override = process.env['AGENTROOM_WORKSPACE_ROOT']?.trim()
  return override && override.length > 0 ? override : homedir()
}

/** UNC (`\\server\share`, `//server/share`) and Windows device paths (`\\?\`, `\\.\`). */
function isUncOrDevicePath(p: string): boolean {
  return /^[\\/]{2}/.test(p)
}

/**
 * Directories that must NEVER be a working_dir (and so never a spawn cwd) even though they
 * sit inside the allow-root: the app's own SQLite + credential store, and the user's
 * credential/secret dirs. Defense-in-depth — the default allow-root is the whole home dir,
 * so without this a "working folder" could point an (eventually-spawned) CLI at ~/.ssh or
 * the app's own data. Only paths that exist can contain a child, so non-existent ones are
 * skipped by the caller.
 */
function sensitiveDirs(): string[] {
  const home = homedir()
  const dots = [
    '.ssh',
    '.aws',
    '.gnupg',
    '.gpg',
    '.config',
    '.kube',
    '.docker',
    '.azure',
    '.gcloud',
  ]
  const list = dots.map((d) => join(home, d))
  if (process.platform === 'darwin') list.push(join(home, 'Library', 'Keychains'))
  list.push(appDataDir()) // ~/.agentroom or %APPDATA%\AgentRoom — the app's own store
  return list
}

/**
 * Reject a workspace root so broad it disables containment: the filesystem root, a bare drive
 * root (`C:\`), or the parent of all home dirs (`/home`, `/Users`). `realRoot` is realpath'd.
 */
function isTooBroadRoot(realRoot: string): boolean {
  const norm = realRoot.replace(/[\\/]+$/, '') // strip trailing separators
  const fsRoot = parse(realRoot).root.replace(/[\\/]+$/, '')
  if (norm === '' || norm === fsRoot) return true // '/', 'C:\'
  if (process.platform === 'win32') {
    if (/^[A-Za-z]:$/.test(norm)) return true // bare drive root
  } else if (norm === '/home' || norm === '/Users') {
    return true
  }
  return false
}

/** True iff `child` is `root` or a descendant of it (case-insensitive on Windows). */
function isWithin(child: string, root: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const c = norm(child)
  const r = norm(root)
  if (c === r) return true
  const rWithSep = r.endsWith(sep) ? r : r + sep
  return c.startsWith(rWithSep)
}

/**
 * Validate a user/session-supplied working directory. Returns the canonical path on success
 * or a reason on failure. NEVER throws. Only a returned `path` may be used as a spawn cwd.
 */
export function validateWorkingDir(input: unknown, opts?: { root?: string }): WorkingDirResult {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return { ok: false, reason: 'working_dir is required' }
  if (raw.includes('\0')) return { ok: false, reason: 'working_dir contains a null byte' }
  if (isUncOrDevicePath(raw)) {
    return { ok: false, reason: 'UNC and device paths are not allowed' }
  }
  if (!isAbsolute(raw)) return { ok: false, reason: 'working_dir must be an absolute path' }

  const root = opts?.root ?? workspaceRoot()
  if (!isAbsolute(root)) {
    return { ok: false, reason: 'workspace root is misconfigured (not an absolute path)' }
  }

  // Canonicalize BOTH sides through realpath so symlinks/junctions are resolved and `..`
  // collapsed — this is what catches traversal AND symlink-escape, not a string check.
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    return { ok: false, reason: 'workspace root does not exist' }
  }
  if (isTooBroadRoot(realRoot)) {
    return {
      ok: false,
      reason: 'workspace root is too broad — set AGENTROOM_WORKSPACE_ROOT to a specific folder',
    }
  }
  let realChild: string
  try {
    realChild = realpathSync(resolve(raw))
  } catch {
    return { ok: false, reason: `Folder not found: ${raw}` }
  }

  try {
    if (!statSync(realChild).isDirectory()) {
      return { ok: false, reason: 'working_dir is not a directory' }
    }
  } catch {
    return { ok: false, reason: 'working_dir is not accessible' }
  }

  if (!isWithin(realChild, realRoot)) {
    return { ok: false, reason: `working_dir must be inside the workspace root (${realRoot})` }
  }

  // Defense-in-depth: never allow a sensitive/credential dir or the app's own store, even
  // though it lives inside the allow-root.
  for (const dir of sensitiveDirs()) {
    let realDir: string
    try {
      realDir = realpathSync(dir)
    } catch {
      continue // doesn't exist → can't contain the child
    }
    if (isWithin(realChild, realDir)) {
      return { ok: false, reason: 'working_dir points at a protected or sensitive directory' }
    }
  }

  return { ok: true, path: realChild }
}
