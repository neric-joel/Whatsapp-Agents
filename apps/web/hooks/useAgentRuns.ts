'use client'
import { useCallback, useEffect, useState } from 'react'

interface DbAgentRun {
  id: string
  status: 'queued' | 'claimed' | 'running' | 'failed' | 'cancelled'
  agent_id: string
  trigger_msg_id: string | null
  error_message: string | null
  discussion_mode: 'independent' | 'tag_turns'
  deliberation_depth: number
  deliberation_root_id: string | null
  created_at: string
  updated_at: string
  agents: { name: string; provider: string } | null
}

const POLL_MS = 1500

/**
 * In-flight / recent agent runs for a room (drives the "thinking…" indicators).
 * Local app: reads the GET API and polls (replaces the Supabase realtime channel).
 */
export function useAgentRuns(roomId: string, refreshSignal?: number) {
  const [runs, setRuns] = useState<DbAgentRun[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/runs`, { cache: 'no-store' })
      const json = await res.json()
      if (json.ok) setRuns((json.data as DbAgentRun[]) ?? [])
    } catch {
      // transient; the next poll will retry
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

  return { runs, loading, refetch }
}
