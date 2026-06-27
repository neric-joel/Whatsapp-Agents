'use client'
import { type FormEvent, useCallback, useEffect, useState } from 'react'

import { AGENT_ADAPTER_TYPES, AGENT_PROVIDERS } from '@/lib/api-validation'

interface Props {
  roomId: string
  onCreated: () => void
}

interface ConnectedProfile {
  id: string
  name: string
  slug: string
  enabled: boolean
}

/**
 * Add an agent to the room. The primary path is "add a connected CLI" — pick one of
 * the CLIs registered on the Connections screen and it joins as a participant
 * (adapter_type 'cli'; the bridge resolves its config.json profile at run time).
 * An advanced section still allows a raw provider/adapter agent (mock/dev).
 *
 * Posts to `POST /api/agents`, which re-enforces membership server-side. A
 * `system_prompt` is sent as plain data — the bridge only ever passes it to a CLI
 * via stdin, never argv.
 */
export default function CreateAgentForm({ roomId, onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [profiles, setProfiles] = useState<ConnectedProfile[]>([])
  const [profileId, setProfileId] = useState<string>('') // '' = advanced/custom agent

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [provider, setProvider] = useState<string>('mock')
  const [adapterType, setAdapterType] = useState<string>('mock')
  const [model, setModel] = useState('')
  const [capabilities, setCapabilities] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')

  const loadProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/connections')
      const json = (await res.json()) as {
        ok: boolean
        data?: { profiles: ConnectedProfile[] }
      }
      if (res.ok && json.ok) setProfiles((json.data?.profiles ?? []).filter((p) => p.enabled))
    } catch {
      /* Connections are optional here; the advanced form still works. */
    }
  }, [])

  useEffect(() => {
    if (open) void loadProfiles()
  }, [open, loadProfiles])

  function reset() {
    setProfileId('')
    setName('')
    setSlug('')
    setProvider('mock')
    setAdapterType('mock')
    setModel('')
    setCapabilities('')
    setSystemPrompt('')
    setError(null)
  }

  function pickProfile(id: string) {
    setProfileId(id)
    const p = profiles.find((x) => x.id === id)
    if (p) {
      setName(p.name)
      setSlug(p.slug)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const isCli = profileId !== ''
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: roomId,
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          provider: isCli ? 'custom' : provider,
          adapter_type: isCli ? 'cli' : adapterType,
          ...(isCli ? { cli_profile_id: profileId } : {}),
          model: model.trim() || undefined,
          capabilities: capabilities.trim() || undefined,
          system_prompt: systemPrompt.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(json.error?.message ?? 'Failed to add agent')
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
          + Add agent
        </button>
      </div>
    )
  }

  const isCli = profileId !== ''
  const inputCls =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)]'

  return (
    <form onSubmit={submit} className="space-y-2 px-3 pt-2" aria-label="Add agent">
      <label className="block text-[10px] text-[var(--muted)]">
        Connected CLI
        <select
          value={profileId}
          onChange={(e) => pickProfile(e.target.value)}
          className={`mt-0.5 ${inputCls}`}
        >
          <option value="">— Advanced: custom / mock agent —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} (@{p.slug})
            </option>
          ))}
        </select>
      </label>
      {profiles.length === 0 && (
        <p className="text-[10px] leading-4 text-[var(--muted)]">
          No CLIs connected yet — open{' '}
          <a href="/connections" className="underline">
            Connections
          </a>{' '}
          to detect or add one.
        </p>
      )}

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        required
        maxLength={80}
        className={inputCls}
      />
      <input
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        placeholder="slug (e.g. my_helper)"
        required
        className={inputCls}
      />

      {!isCli && (
        <div className="flex gap-2">
          <label className="flex-1 text-[10px] text-[var(--muted)]">
            Provider
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
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
              className={`mt-0.5 ${inputCls}`}
            >
              {AGENT_ADAPTER_TYPES.filter((a) => a !== 'cli').map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!isCli && (
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model (optional)"
          className={inputCls}
        />
      )}
      <input
        value={capabilities}
        onChange={(e) => setCapabilities(e.target.value)}
        placeholder="capabilities blurb (optional)"
        maxLength={500}
        className={inputCls}
      />
      <textarea
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder="role / system prompt (optional)"
        rows={3}
        maxLength={8000}
        className={`resize-none ${inputCls}`}
      />
      <p className="text-[10px] leading-4 text-[var(--muted)]">
        Visible to room members — don’t put secrets in the system prompt.
      </p>
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
          {submitting ? 'Adding…' : isCli ? 'Add to room' : 'Create'}
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
