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
 * cwd out of system directories and to defeat traversal/symlink escapes.
 */
import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve, sep } from 'node:path'

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
  return { ok: true, path: realChild }
}
