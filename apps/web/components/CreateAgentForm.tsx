'use client'
import { type FormEvent, useState } from 'react'

import { AGENT_ADAPTER_TYPES, AGENT_PROVIDERS } from '@/lib/api-validation'

interface Props {
  roomId: string
  onCreated: () => void
}

/**
 * Admin-only "Create agent" surface (Phase 11). Posts to `POST /api/agents`,
 * which re-enforces admin+ membership server-side and attaches the new agent to
 * the room. `system_prompt` is sent as plain data — the bridge only ever passes
 * it to a CLI via stdin, never argv.
 */
export default function CreateAgentForm({ roomId, onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [provider, setProvider] = useState<string>('mock')
  const [adapterType, setAdapterType] = useState<string>('mock')
  const [model, setModel] = useState('')
  const [capabilities, setCapabilities] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')

  function reset() {
    setName('')
    setSlug('')
    setProvider('mock')
    setAdapterType('mock')
    setModel('')
    setCapabilities('')
    setSystemPrompt('')
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: roomId,
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          provider,
          adapter_type: adapterType,
          model: model.trim() || undefined,
          capabilities: capabilities.trim() || undefined,
          system_prompt: systemPrompt.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(json.error?.message ?? 'Failed to create agent')
        return
      }
      reset()
      setOpen(false)
      onCreated()
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <div className="px-3 pt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
        >
          + Create agent
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2 px-3 pt-2" aria-label="Create agent">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        required
        maxLength={80}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]"
      />
      <input
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        placeholder="slug (e.g. my_helper)"
        required
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]"
      />
      <div className="flex gap-2">
        <label className="flex-1 text-[10px] text-[var(--muted)]">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]"
          >
            {AGENT_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 text-[10px] text-[var(--muted)]">
          Adapter
          <select
            value={adapterType}
            onChange={(e) => setAdapterType(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]"
          >
            {AGENT_ADAPTER_TYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="model (optional)"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]"
      />
      <input
        value={capabilities}
        onChange={(e) => setCapabilities(e.target.value)}
        placeholder="capabilities blurb (optional)"
        maxLength={500}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]"
      />
      <textarea
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder="system prompt (optional)"
        rows={3}
        maxLength={8000}
        className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]"
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-40"
        >
          {submitting ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
