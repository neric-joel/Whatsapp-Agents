'use client'
import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { getApiErrorMessage } from '@/lib/api-client'
import type { Room } from '@agentroom/shared'

type CreateRoomResponse = { ok: true; data: Room } | { ok: false; error: unknown }
type DeleteRoomResponse = { ok: true; data: { deleted: true } } | { ok: false; error: unknown }

export function useRooms(enabled = true) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }

    const supabase = createSupabaseBrowserClient()
    setLoading(true)
    supabase
      .from('rooms')
      .select('id, name, created_at')
      .order('created_at')
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setRooms((data as Room[]) ?? [])
        setLoading(false)
      })
  }, [enabled])

  const createRoom = useCallback(async (name = `Room ${rooms.length + 1}`) => {
    setCreating(true)
    setCreateError(null)

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const payload = (await res.json().catch(() => null)) as CreateRoomResponse | null

      if (!res.ok || !payload?.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to create room'))
      }

      setRooms((current) => [payload.data, ...current])
      return payload.data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create room'
      setCreateError(message)
      return null
    } finally {
      setCreating(false)
    }
  }, [rooms.length])

  const deleteRoom = useCallback(async (roomId: string) => {
    setDeletingRoomId(roomId)
    setDeleteError(null)

    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const payload = (await res.json().catch(() => null)) as DeleteRoomResponse | null

      if (!res.ok || !payload?.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to delete room'))
      }

      setRooms((current) => current.filter((room) => room.id !== roomId))
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete room'
      setDeleteError(message)
      return false
    } finally {
      setDeletingRoomId(null)
    }
  }, [])

  return {
    rooms,
    loading,
    error,
    createRoom,
    creating,
    createError,
    deleteRoom,
    deletingRoomId,
    deleteError,
  }
}
