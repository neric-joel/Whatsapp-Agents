'use client'
import { useCallback, useEffect, useState } from 'react'

interface ToolCallRow {
  id: string
  room_id: string
  tool_name: string
  input_args: Record<string, unknown>
  output: string | Record<string, unknown> | null
  status: string
  error: string | null
}

const POLL_MS = 1500

/**
 * Tool-call approval requests for a room. Local app: reads the GET API and polls
 * (replaces the Supabase realtime channel).
 */
export function useToolCalls(roomId: string, refreshSignal?: number) {
  const [toolCalls, setToolCalls] = useState<ToolCallRow[]>([])

  const fetchToolCalls = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/tool-calls`, { cache: 'no-store' })
      const json = await res.json()
      if (json.ok) setToolCalls((json.data as ToolCallRow[]) ?? [])
    } catch {
      // transient; the next poll will retry
    }
  }, [roomId])

  useEffect(() => {
    void fetchToolCalls()
  }, [fetchToolCalls, refreshSignal])

  useEffect(() => {
    const t = setInterval(() => void fetchToolCalls(), POLL_MS)
    return () => clearInterval(t)
  }, [fetchToolCalls])

  return toolCalls
}
