'use client'
import type { Room } from '@agentroom/shared'
import { useCallback, useEffect, useState } from 'react'

/**
 * The room list. Local app: reads the GET API on demand (refreshRooms is called
 * after create/archive). No polling — the sidebar refetches on user actions.
 */
export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshRooms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rooms', { cache: 'no-store' })
      const json = await res.json()
      if (!json.ok) setError(json.error?.message ?? 'Failed to load rooms')
      else {
        setRooms((json.data as Room[]) ?? [])
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rooms')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshRooms()
  }, [refreshRooms])

  return { rooms, loading, error, refreshRooms }
}
