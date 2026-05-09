'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { Room } from '@agentroom/shared'

export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase
      .from('rooms')
      .select('id, name, created_at')
      .order('created_at')
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setRooms((data as Room[]) ?? [])
        setLoading(false)
      })
  }, [])

  return { rooms, loading, error }
}
