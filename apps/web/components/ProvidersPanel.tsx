'use client'
import { useCallback, useEffect, useState } from 'react'

interface CredentialRow {
  id: string
  provider: string
  label: string
  base_url: string | null
  is_default: boolean
  has_secret: boolean
  created_at: string
}

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI (Codex / API key → OPENAI_API_KEY)' },
  { value: 'claude_code', label: 'Anthropic (Claude → ANTHROPIC_API_KEY)' },
  { value: 'codex', label: 'Codex' },
  { value: 'custom', label: 'Custom' },
]

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * WS2 (ADR-0010) — manage per-user provider credentials. The secret is write-only:
 * it is sent on create, never returned, and the form never re-displays it. Meets the
 * UI/UX states contract (loading / empty / error / success).
 */
export default function ProvidersPanel() {
  const [rows, setRows] = useState<CredentialRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [provider, setProvider] = useState('openai')
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/credentials')
      const json = (await res.json()) as {
        ok: boolean
        data?: CredentialRow[]
        error?: { message?: string }
      }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to load credentials')
      setRows(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          label: label.trim(),
          secret,
          ...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
          is_default: isDefault,
        }),
      })
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to save credential')
      // Clear the write-only secret + form on success.
      setLabel('')
      setSecret('')
      setBaseUrl('')
      setIsDefault(false)
      setNotice('Credential saved. The secret is encrypted and never shown again.')
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save credential')
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete(id: string) {
    setNotice(null)
    const res = await fetch(`/api/credentials/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setRows((prev) => prev.filter((r) => r.id !== id))
      setNotice('Credential deleted.')
    } else {
      setError('Failed to delete credential')
    }
  }

  return (
    <section className="mx-auto w-full max-w-2xl p-4">
      <h2 className="mb-1 text-lg font-semibold text-[var(--text)]">Providers &amp; API keys</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Bring your own CLI/API key. Secrets are encrypted at rest and used only to fuel agents you
        create — they are never shown again and never sent to the browser.
      </p>

      <form
        onSubmit={onSubmit}
        aria-label="Add a provider credential"
        className="mb-6 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"
      >
        <div>
          <label htmlFor="cred-provider" className="block text-xs font-medium text-[var(--text)]">
            Provider
          </label>
          <select
            id="cred-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--text)]"
          >
            {PROVIDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cred-label" className="block text-xs font-medium text-[var(--text)]">
            Label
          </label>
          <input
            id="cred-label"
            type="text"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. My OpenAI key"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--text)]"
          />
        </div>
        <div>
          <label htmlFor="cred-secret" className="block text-xs font-medium text-[var(--text)]">
            Secret (API key) <span className="text-[var(--muted)]">— write-only</span>
          </label>
          <input
            id="cred-secret"
            type="password"
            required
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="sk-…"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--text)]"
          />
        </div>
        <div>
          <label htmlFor="cred-baseurl" className="block text-xs font-medium text-[var(--text)]">
            Base URL <span className="text-[var(--muted)]">(optional, https)</span>
          </label>
          <input
            id="cred-baseurl"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://…"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm text-[var(--text)]"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--text)]">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Make default for this provider
        </label>

        {formError && (
          <p role="alert" className="text-sm text-red-600">
            {formError}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-green-700">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !label.trim() || !secret}
          className="rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Add credential'}
        </button>
      </form>

      <h3 className="mb-2 text-sm font-medium text-[var(--text)]">Your credentials</h3>
      {error && (
        <div role="alert" className="rounded-lg p-3 text-sm text-red-600">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="underline">
            Retry
          </button>
        </div>
      )}
      {!error && loading && (
        <div role="status" className="p-3 text-sm text-[var(--muted)]">
          Loading credentials…
        </div>
      )}
      {!error && !loading && rows.length === 0 && (
        <div
          role="status"
          className="rounded-lg border border-[var(--border)] p-4 text-center text-sm text-[var(--muted)]"
        >
          No credentials yet. Add one above to fuel your agents with your own key.
        </div>
      )}
      {!error && !loading && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--text)]">
                  {row.label}
                  {row.is_default && (
                    <span className="ml-2 rounded bg-[var(--accent-strong)]/15 px-1.5 py-0.5 text-[11px] text-[var(--accent-strong)]">
                      default
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {row.provider}
                  {row.base_url ? ` · ${row.base_url}` : ''} · added {formatDate(row.created_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onDelete(row.id)}
                aria-label={`Delete credential ${row.label}`}
                className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:text-red-600"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
