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

  // Refetch on mount and when refreshSignal changes (optimistic clear from ComposeBox)
  useEffect(() => {
    refetch()
  }, [refetch, refreshSignal])

  // Realtime: append INSERT events, dedup by id
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`messages-rt-${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        async (payload) => {
          const newId = (payload.new as { id: string }).id
          // Fetch with agents join so we have the agent name
          const { data } = await supabase
            .from('messages')
            .select('id, content, sender_type, created_at, sender_agent_id, agents(name, provider)')
            .eq('id', newId)
            .single()
          if (data) {
            const msg = data as unknown as DbMessage
            setMessages((prev) =>
              prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
            )
          }
        }
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [roomId])

  return { messages, loading, error, refetch }
}
