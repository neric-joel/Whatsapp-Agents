'use client'
import { useCallback, useEffect, useState } from 'react'

type ProbeStatus = 'ready' | 'error' | 'not_found'

interface Probe {
  path: string | null
  status: ProbeStatus
  version: string | null
  detail: string | null
}

interface DetectedCli {
  key: string
  name: string
  slug: string
  command: string
  defaultArgs: string[]
  kind: 'claude-code' | 'codex-cli' | 'generic'
  authHint: string
  path: string | null
  status: ProbeStatus
  version: string | null
  detail: string | null
}

interface Profile {
  id: string
  name: string
  slug: string
  bin: string
  args: string[]
  env?: Record<string, string>
  kind: 'claude-code' | 'codex-cli' | 'generic'
  enabled: boolean
  probe: Probe
}

const STATUS_BADGE: Record<ProbeStatus, { label: string; cls: string }> = {
  ready: { label: 'detected ✓', cls: 'bg-green-500/15 text-green-700' },
  error: { label: 'found, check needed', cls: 'bg-amber-500/15 text-amber-700' },
  not_found: { label: 'not found ✗', cls: 'bg-[var(--border)] text-[var(--muted)]' },
}

function StatusBadge({ status }: { status: ProbeStatus }) {
  const b = STATUS_BADGE[status]
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${b.cls}`}>{b.label}</span>
}

/**
 * Connections screen — auto-detect installed agent CLIs (PATH probe + `--version`)
 * and register your own (BYO). AgentRoom never asks for a CLI's API key: a profile
 * only records where the binary is and how to run it; auth is the CLI's own job.
 */
export default function ConnectionsPanel() {
  const [detected, setDetected] = useState<DetectedCli[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // BYO custom-CLI form
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [bin, setBin] = useState('')
  const [args, setArgs] = useState('')
  const [kind, setKind] = useState<'generic' | 'claude-code' | 'codex-cli'>('generic')
  const [envText, setEnvText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/connections')
      const json = (await res.json()) as {
        ok: boolean
        data?: { detected: DetectedCli[]; profiles: Profile[] }
        error?: { message?: string }
      }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to load connections')
      setDetected(json.data?.detected ?? [])
      setProfiles(json.data?.profiles ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connections')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const connectedSlugs = new Set(profiles.map((p) => p.slug))

  async function saveProfile(body: Record<string, unknown>, busyKey: string) {
    setBusyId(busyKey)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to save CLI')
      setNotice(`Connected ${String(body.name)}.`)
      await load()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save CLI')
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function connectDetected(cli: DetectedCli) {
    // Reconnect updates the existing profile in place (reuse its id) rather than
    // creating a duplicate that shares the slug.
    const existing = profiles.find((p) => p.slug === cli.slug)
    await saveProfile(
      {
        ...(existing ? { id: existing.id } : {}),
        name: cli.name,
        slug: cli.slug,
        bin: cli.path ?? cli.command,
        args: cli.defaultArgs,
        kind: cli.kind,
        enabled: true,
      },
      `detected:${cli.key}`,
    )
  }

  async function toggleEnabled(p: Profile) {
    await saveProfile(
      {
        id: p.id,
        name: p.name,
        slug: p.slug,
        bin: p.bin,
        args: p.args,
        kind: p.kind,
        enabled: !p.enabled,
        ...(p.env ? { env: p.env } : {}),
      },
      `toggle:${p.id}`,
    )
  }

  async function removeProfile(p: Profile) {
    if (
      !globalThis.confirm(
        `Remove "${p.name}"? Agents already in rooms that use it will stop replying.`,
      )
    ) {
      return
    }
    setBusyId(`remove:${p.id}`)
    setError(null)
    try {
      const res = await fetch(`/api/connections/${p.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove CLI')
      setNotice(`Removed ${p.name}.`)
      setProfiles((prev) => prev.filter((x) => x.id !== p.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove CLI')
    } finally {
      setBusyId(null)
    }
  }

  function parseEnv(text: string): Record<string, string> | undefined {
    const out: Record<string, string> = {}
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
    return Object.keys(out).length ? out : undefined
  }

  async function onSubmitCustom(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      const env = parseEnv(envText)
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          bin: bin.trim(),
          args: args.trim() ? args.trim().split(/\s+/) : [],
          kind,
          enabled: true,
          ...(env ? { env } : {}),
        }),
      })
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to add CLI')
      setName('')
      setSlug('')
      setBin('')
      setArgs('')
      setEnvText('')
      setKind('generic')
      setNotice('Custom CLI connected.')
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add CLI')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--text)]'

  return (
    <section className="mx-auto w-full max-w-2xl p-4">
      <h2 className="mb-1 text-lg font-semibold text-[var(--text)]">Connections</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Connect the agent CLIs you already have installed. AgentRoom never asks for an API key — it
        just runs the binary, which uses whatever login that CLI already stored. See{' '}
        <a
          href="https://github.com/neric-joel/Whatsapp-Agents/blob/main/docs/CONNECTING_CLIS.md"
          className="underline"
          target="_blank"
          rel="noreferrer"
        >
          docs/CONNECTING_CLIS.md
        </a>
        .
      </p>

      {error && (
        <div role="alert" className="mb-3 rounded-lg p-3 text-sm text-red-600">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="underline">
            Retry
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="mb-3 text-sm text-green-700">
          {notice}
        </p>
      )}

      {/* ── Auto-detected ─────────────────────────────────────────── */}
      <h3 className="mb-2 text-sm font-medium text-[var(--text)]">Detected on your machine</h3>
      {loading && (
        <div role="status" className="p-3 text-sm text-[var(--muted)]">
          Probing your PATH for installed CLIs…
        </div>
      )}
      {!loading && (
        <ul className="mb-6 space-y-2">
          {detected.map((cli) => (
            <li
              key={cli.key}
              className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                    {cli.name} <StatusBadge status={cli.status} />
                    {connectedSlugs.has(cli.slug) && (
                      <span className="text-[11px] text-[var(--muted)]">· connected</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-[var(--muted)]">
                    {cli.path ?? `not on PATH (looked for "${cli.command}")`}
                    {cli.version ? ` · ${cli.version}` : ''}
                    {cli.detail ? ` · ${cli.detail}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={cli.status === 'not_found' || busyId === `detected:${cli.key}`}
                  onClick={() => void connectDetected(cli)}
                  className="shrink-0 rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
                >
                  {connectedSlugs.has(cli.slug) ? 'Reconnect' : 'Connect'}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-[var(--muted)]">{cli.authHint}</p>
            </li>
          ))}
        </ul>
      )}

      {/* ── Connected profiles ────────────────────────────────────── */}
      <h3 className="mb-2 text-sm font-medium text-[var(--text)]">Connected CLIs</h3>
      {!loading && profiles.length === 0 && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-[var(--border)] p-4 text-center text-sm text-[var(--muted)]"
        >
          Nothing connected yet. Connect a detected CLI above, or add your own below.
        </div>
      )}
      {profiles.length > 0 && (
        <ul className="mb-6 space-y-2">
          {profiles.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                  {p.name} <span className="text-xs text-[var(--muted)]">@{p.slug}</span>
                  <StatusBadge status={p.probe.status} />
                  {!p.enabled && (
                    <span className="text-[11px] text-[var(--muted)]">· disabled</span>
                  )}
                </div>
                <div className="truncate text-xs text-[var(--muted)]">
                  {p.bin} {p.args.join(' ')}
                  {p.probe.detail ? ` · ${p.probe.detail}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === `toggle:${p.id}`}
                  onClick={() => void toggleEnabled(p)}
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]"
                >
                  {p.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  disabled={busyId === `remove:${p.id}`}
                  onClick={() => void removeProfile(p)}
                  aria-label={`Remove ${p.name}`}
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Add a custom CLI (BYO) ────────────────────────────────── */}
      <h3 className="mb-2 text-sm font-medium text-[var(--text)]">Add your own CLI</h3>
      <form
        onSubmit={onSubmitCustom}
        aria-label="Add a custom CLI"
        className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="cli-name" className="block text-xs font-medium text-[var(--text)]">
              Display name
            </label>
            <input
              id="cli-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Local Model"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="cli-slug" className="block text-xs font-medium text-[var(--text)]">
              @mention handle
            </label>
            <input
              id="cli-slug"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="mymodel"
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label htmlFor="cli-bin" className="block text-xs font-medium text-[var(--text)]">
            Binary path or command
          </label>
          <input
            id="cli-bin"
            required
            value={bin}
            onChange={(e) => setBin(e.target.value)}
            placeholder="/usr/local/bin/mycli  (or just: mycli)"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="cli-args" className="block text-xs font-medium text-[var(--text)]">
            Arguments <span className="text-[var(--muted)]">(space-separated, optional)</span>
          </label>
          <input
            id="cli-args"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="chat --stdin"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="cli-kind" className="block text-xs font-medium text-[var(--text)]">
            Output format
          </label>
          <select
            id="cli-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className={inputCls}
          >
            <option value="generic">Generic (reads stdin, prints the reply to stdout)</option>
            <option value="claude-code">Claude Code (claude --print --output-format json)</option>
            <option value="codex-cli">Codex (codex exec --json)</option>
          </select>
        </div>
        <div>
          <label htmlFor="cli-env" className="block text-xs font-medium text-[var(--text)]">
            Extra env <span className="text-[var(--muted)]">(KEY=value per line, optional)</span>
          </label>
          <textarea
            id="cli-env"
            rows={2}
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder="# Usually leave blank — the CLI uses its own login"
            className={`${inputCls} font-mono`}
          />
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Most CLIs need nothing here — auth is the CLI&apos;s job. Only add a variable if your
            CLI specifically requires one.
          </p>
        </div>

        {formError && (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !name.trim() || !slug.trim() || !bin.trim()}
          aria-busy={submitting}
          className="rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add CLI'}
        </button>
      </form>
    </section>
  )
}
