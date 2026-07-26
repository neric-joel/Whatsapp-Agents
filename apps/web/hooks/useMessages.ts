'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

interface DbMessage {
  id: string
  content: string
  sender_type: string
  sender_user_id: string | null
  created_at: string
  updated_at: string
  sender_agent_id: string | null
  reply_to_id: string | null
  content_type?: string
  metadata: Record<string, unknown>
  agents: { name: string; provider: string } | null
}

const POLL_MS = 1500

interface MessagesState {
  roomId: string
  messages: DbMessage[]
}

export function shouldApplyMessagesResponse(
  requestRoomId: string,
  currentRoomId: string,
  requestSeq: number,
  latestSeq: number,
) {
  return requestRoomId === currentRoomId && requestSeq === latestSeq
}

export function messagesForRoom(state: MessagesState, roomId: string) {
  return state.roomId === roomId ? state.messages : []
}

/**
 * Messages for a room. Local app: reads the GET API and polls for live updates
 * (replaces the old Supabase realtime channel). `refreshSignal` forces an
 * immediate refetch (e.g. after the compose box clears the chat).
 */
export function useMessages(roomId: string, refreshSignal?: number) {
  const [state, setState] = useState<MessagesState>({ roomId, messages: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const currentRoomIdRef = useRef(roomId)
  const requestSeqRef = useRef(0)

  const refetch = useCallback(async () => {
    const requestRoomId = roomId
    const requestSeq = requestSeqRef.current + 1
    requestSeqRef.current = requestSeq
    try {
      const res = await fetch(`/api/rooms/${requestRoomId}/messages`, { cache: 'no-store' })
      const json = await res.json()
      if (
        !shouldApplyMessagesResponse(
          requestRoomId,
          currentRoomIdRef.current,
          requestSeq,
          requestSeqRef.current,
        )
      ) {
        return
      }
      if (!json.ok) setError(json.error?.message ?? 'Failed to load messages')
      else {
        setState({ roomId: requestRoomId, messages: (json.data as DbMessage[]) ?? [] })
        setError(null)
      }
    } catch (e) {
      if (
        !shouldApplyMessagesResponse(
          requestRoomId,
          currentRoomIdRef.current,
          requestSeq,
          requestSeqRef.current,
        )
      ) {
        return
      }
      setError(e instanceof Error ? e.message : 'Failed to load messages')
    } finally {
      if (
        shouldApplyMessagesResponse(
          requestRoomId,
          currentRoomIdRef.current,
          requestSeq,
          requestSeqRef.current,
        )
      ) {
        setLoading(false)
      }
    }
  }, [roomId])

  useEffect(() => {
    currentRoomIdRef.current = roomId
    setLoading(true)
    setError(null)
  }, [roomId])

  useEffect(() => {
    void refetch()
  }, [refetch, refreshSignal])

  useEffect(() => {
    const t = setInterval(() => void refetch(), POLL_MS)
    return () => clearInterval(t)
  }, [refetch])

  const messages = messagesForRoom(state, roomId)
  return { messages, loading: state.roomId === roomId ? loading : true, error, refetch }
}
