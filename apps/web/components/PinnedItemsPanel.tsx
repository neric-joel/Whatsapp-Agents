'use client'
import { useEffect, useState } from 'react'

import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface PinnedItemRow {
  id: string
  room_id: string
  pin_type: string
  title: string | null
  content: string | null
  is_active: boolean
  created_at: string
  sort_order: number
}

interface Props {
  roomId: string
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function PinnedItemsPanel({ roomId }: Props) {
  const [pins, setPins] = useState<PinnedItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)
    fetch(`/api/rooms/${roomId}/pins`)
      .then(async (res) => {
        const json = (await res.json()) as {
          ok: boolean
          data?: PinnedItemRow[]
          error?: { message?: string }
        }
        if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to load pins')
        return json
      })
      .then((json: { ok: boolean; data?: PinnedItemRow[] }) => {
        if (mounted && json.ok) setPins(json.data ?? [])
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to load pins')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [roomId])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const sub = supabase
      .channel(`pins:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pinned_items',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const next = payload.new as PinnedItemRow
            if (next.is_active)
              setPins((prev) => [...prev, next].sort((a, b) => a.sort_order - b.sort_order))
          } else if (payload.eventType === 'UPDATE') {
            const next = payload.new as PinnedItemRow
            setPins((prev) => {
              const merged = next.is_active
                ? prev.map((pin) => (pin.id === next.id ? next : pin))
                : prev.filter((pin) => pin.id !== next.id)
              return (
                next.is_active && !merged.some((pin) => pin.id === next.id)
                  ? [...merged, next]
                  : merged
              ).sort((a, b) => a.sort_order - b.sort_order)
            })
          } else if (payload.eventType === 'DELETE') {
            const oldPin = payload.old as { id?: string }
            setPins((prev) => prev.filter((pin) => pin.id !== oldPin.id))
          }
        },
      )
      .subscribe()
    return () => {
      void sub.unsubscribe()
    }
  }, [roomId])

  async function unpin(pinId: string) {
    await fetch(`/api/pins/${pinId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    })
    setPins((prev) => prev.filter((pin) => pin.id !== pinId))
  }

  if (error)
    return (
      <div role="alert" className="p-4 text-red-600 text-sm">
        Failed to load pins
      </div>
    )
  if (loading)
    return (
      <div role="status" className="p-4 text-[var(--muted)] text-sm">
        Loading pins...
      </div>
    )
  if (pins.length === 0)
    return (
      <div role="status" className="p-4 text-[var(--muted)] text-xs text-center">
        Nothing pinned yet. Pin a message to save it here.
      </div>
    )

  return (
    <div className="space-y-2 px-3 py-3">
      {pins.map((pin) => (
        <div
          key={pin.id}
          className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-sm"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--accent-strong)]">{pin.pin_type}</span>
            <span className="text-[11px] text-[var(--muted)]">{formatDate(pin.created_at)}</span>
          </div>
          {pin.title && (
            <div className="truncate text-sm font-medium text-[var(--text)]">{pin.title}</div>
          )}
          {pin.content && (
            <div
              className="mt-1 overflow-hidden text-xs leading-5 text-[var(--muted)]"
              style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
            >
              {pin.content}
            </div>
          )}
          <button
            type="button"
            onClick={() => void unpin(pin.id)}
            className="mt-2 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            Unpin
          </button>
        </div>
      ))}
    </div>
  )
}
