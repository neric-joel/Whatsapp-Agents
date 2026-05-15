'use client'
import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Room } from '@agentroom/shared'

export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshRooms = useCallback(async () => {
    const supabase = createSupabaseBrowserClient()
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('rooms')
      .select('id, name, created_at, is_archived')
      .order('created_at')
    if (err) setError(err.message)
    else setRooms((data as Room[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void refreshRooms()
  }, [refreshRooms])

  return { rooms, loading, error, refreshRooms }
}
