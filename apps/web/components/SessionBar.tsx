'use client'
import type { Session } from '@agentroom/shared'
import { type FormEvent, useState } from 'react'

interface Props {
  sessions: Session[]
  active: Session | null
  loading: boolean
  onCreate: (workingDir: string, name?: string) => Promise<Session>
  onRename: (id: string, name: string) => Promise<void>
  onSwitch: (id: string) => Promise<void>
}

/**
 * The Cowork-style session header: shows the active working context (name + folder),
 * lets you switch/rename, and — on first run with no sessions — prompts you to pick a
 * working folder. A session is "the folder you're working in" plus the rooms inside it.
 */
export default function SessionBar({
  sessions,
  active,
  loading,
  onCreate,
  onRename,
  onSwitch,
}: Props) {
  const [creating, setCreating] = useState(false)
  const [dir, setDir] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')

  async function submitCreate(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await onCreate(dir.trim(), name.trim() || undefined)
      setDir('')
      setName('')
      setCreating(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create session')
    } finally {
      setBusy(false)
    }
  }

  async function saveRename() {
    const next = draftName.trim()
    if (active && next && next !== active.name) {
      try {
        await onRename(active.id, next)
      } catch {
        /* surfaced on next load */
      }
    }
    setEditingName(false)
  }

  const inputCls =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]'

  // First run (no sessions) OR explicitly creating: show the working-folder picker.
  const showForm = creating || (!loading && sessions.length === 0)

  return (
    <div
      className="border-b border-[var(--border)] px-4 py-3"
      role="group"
      aria-label="Working session"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-widest text-[var(--muted)]">
          Session
        </span>
        {sessions.length > 0 && !showForm && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--accent-strong)]"
          >
            ＋ New
          </button>
        )}
      </div>

      {showForm ? (
        <form onSubmit={submitCreate} className="space-y-2" aria-label="Start a session">
          <p className="text-[11px] leading-4 text-[var(--muted)]">
            Pick a working folder to start — the place your agents work in.
          </p>
          <input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="Working folder (absolute path)"
            aria-label="Working folder"
            required
            className={inputCls}
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Session name (optional)"
            aria-label="Session name"
            className={inputCls}
          />
          {err && (
            <p role="alert" className="text-[11px] text-red-600">
              {err}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !dir.trim()}
              className="flex-1 rounded-lg bg-[var(--accent)] px-2 py-1.5 text-xs font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-40"
            >
              {busy ? 'Opening…' : 'Open folder'}
            </button>
            {sessions.length > 0 && (
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : active ? (
        <div>
          {editingName ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={saveRename}
              onKeyDown={(e) => {
                // Enter blurs → onBlur saves once (avoids an Enter+blur double PATCH).
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setEditingName(false)
              }}
              aria-label="Rename session"
              className={inputCls}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraftName(active.name)
                setEditingName(true)
              }}
              title="Click to rename"
              className="block w-full truncate text-left text-sm font-semibold text-[var(--text)] hover:underline"
            >
              {active.name}
            </button>
          )}
          <div
            className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted)]"
            title={active.working_dir}
          >
            {active.working_dir}
          </div>
          {sessions.length > 1 && (
            <select
              value={active.id}
              onChange={(e) => void onSwitch(e.target.value)}
              aria-label="Switch session"
              className={`mt-2 ${inputCls}`}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-[var(--muted)]">Loading…</p>
      )}
    </div>
  )
}
