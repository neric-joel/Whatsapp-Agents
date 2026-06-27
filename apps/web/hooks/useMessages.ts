'use client'
import { useCallback, useEffect, useState } from 'react'

interface DbMessage {
  id: string
  content: string
  sender_type: string
  sender_user_id: string | null
  created_at: string
  sender_agent_id: string | null
  reply_to_id: string | null
  content_type?: string
  metadata: Record<string, unknown>
  agents: { name: string; provider: string } | null
}

const POLL_MS = 1500

/**
 * Messages for a room. Local app: reads the GET API and polls for live updates
 * (replaces the old Supabase realtime channel). `refreshSignal` forces an
 * immediate refetch (e.g. after the compose box clears the chat).
 */
export function useMessages(roomId: string, refreshSignal?: number) {
  const [messages, setMessages] = useState<DbMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`, { cache: 'no-store' })
      const json = await res.json()
      if (!json.ok) setError(json.error?.message ?? 'Failed to load messages')
      else {
        setMessages((json.data as DbMessage[]) ?? [])
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    void refetch()
  }, [refetch, refreshSignal])

  useEffect(() => {
    const t = setInterval(() => void refetch(), POLL_MS)
    return () => clearInterval(t)
  }, [refetch])

  return { messages, loading, error, refetch }
}
