'use client'
import { useEffect, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export interface DbMessage {
  id: string
  content: string
  sender_type: string
  created_at: string
  sender_agent_id: string | null
  agents: { name: string; provider: string } | null
}

export function useMessages(roomId: string, refreshSignal?: number) {
  const [messages, setMessages] = useState<DbMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(() => {
    const supabase = createSupabaseBrowserClient()
    supabase
      .from('messages')
      .select('id, content, sender_type, created_at, sender_agent_id, agents(name, provider)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setMessages((data as unknown as DbMessage[]) ?? [])
        setLoading(false)
      })
  }, [roomId])

  useEffect(() => {
    refetch()
  }, [refetch, refreshSignal])

  return { messages, loading, error, refetch }
}
