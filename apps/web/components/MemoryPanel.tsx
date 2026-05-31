'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface MemoryRow {
  id: string
  room_id: string | null
  agent_id: string | null
  scope: 'global' | 'room'
  kind: string
  title: string | null
  content: string
  pinned: boolean
  is_active: boolean
  injection_flagged: boolean
  created_at: string
}

interface Props {
  roomId: string
}

/** ComposeBox dispatches this when the user types `/recall <query>`. */
export const RECALL_EVENT = 'agentroom:recall'
export interface RecallEventDetail {
  roomId: string
  query: string
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function MemoryPanel({ roomId }: Props) {
  const [rows, setRows] = useState<MemoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const queryRef = useRef('')

  const load = useCallback(
    async (q: string) => {
      setLoading(true)
      setError(null)
      try {
        const url = q
          ? `/api/rooms/${roomId}/memory?q=${encodeURIComponent(q)}`
          : `/api/rooms/${roomId}/memory`
        const res = await fetch(url)
        const json = (await res.json()) as {
          ok: boolean
          data?: MemoryRow[]
          error?: { message?: string }
        }
        if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to load memory')
        setRows(json.data ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load memory')
      } finally {
        setLoading(false)
      }
    },
    [roomId],
  )

  useEffect(() => {
    void load('')
  }, [load])

  // Live updates (mirrors PinnedItemsPanel). Only reflect the unfiltered list.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const sub = supabase
      .channel(`memory:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_memory', filter: `room_id=eq.${roomId}` },
        () => {
          if (!queryRef.current) void load('')
        },
      )
      .subscribe()
    return () => {
      void sub.unsubscribe()
    }
  }, [roomId, load])

  // Respond to `/recall <query>` from the compose box.
  useEffect(() => {
    function onRecall(e: Event) {
      const detail = (e as CustomEvent<RecallEventDetail>).detail
      if (!detail || detail.roomId !== roomId) return
      setQuery(detail.query)
      queryRef.current = detail.query
      void load(detail.query)
    }
    window.addEventListener(RECALL_EVENT, onRecall)
    return () => window.removeEventListener(RECALL_EVENT, onRecall)
  }, [roomId, load])

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    queryRef.current = query.trim()
    void load(query.trim())
  }

  async function setMemoryFlags(id: string, updates: { pinned?: boolean; is_active?: boolean }) {
    await fetch(`/api/memory/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    setRows((prev) =>
      updates.is_active === false
        ? prev.filter((r) => r.id !== id)
        : prev.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    )
  }

  return (
    <div className="flex flex-col">
      <form onSubmit={onSearchSubmit} className="px-3 py-2">
        <label htmlFor="memory-search" className="sr-only">
          Search memory
        </label>
        <input
          id="memory-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Recall memory…"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-xs text-[var(--text)]"
        />
      </form>

      {error && (
        <div role="alert" className="p-4 text-red-600 text-sm">
          Failed to load memory
        </div>
      )}
      {!error && loading && (
        <div role="status" className="p-4 text-[var(--muted)] text-sm">
          Loading memory…
        </div>
      )}
      {!error && !loading && rows.length === 0 && (
        <div role="status" className="p-4 text-[var(--muted)] text-xs text-center">
          {query
            ? 'No memory matched your recall.'
            : 'No memory yet. Use /remember <note> to save one.'}
        </div>
      )}

      {!error && !loading && rows.length > 0 && (
        <ul className="space-y-2 px-3 py-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-sm"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--accent-strong)]">
                  {row.kind}
                  {row.scope === 'global' ? ' · global' : ''}
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {formatDate(row.created_at)}
                </span>
              </div>
              {row.title && (
                <div className="truncate text-sm font-medium text-[var(--text)]">{row.title}</div>
              )}
              <div
                className="mt-1 overflow-hidden text-xs leading-5 text-[var(--muted)]"
                style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}
              >
                {row.content}
              </div>
              {row.injection_flagged && (
                <div className="mt-1 text-[11px] text-amber-600" title="Stored strictly as data">
                  ⚠ flagged — stored as data only
                </div>
              )}
              <div className="mt-2 flex gap-3 text-xs text-[var(--muted)]">
                <button
                  type="button"
                  onClick={() => void setMemoryFlags(row.id, { pinned: !row.pinned })}
                  className="transition-colors hover:text-[var(--text)]"
                >
                  {row.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  onClick={() => void setMemoryFlags(row.id, { is_active: false })}
                  className="transition-colors hover:text-[var(--text)]"
                >
                  Forget
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
