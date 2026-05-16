'use client'
import { useEffect, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export interface DbAgentRun {
  id: string
  status: 'queued' | 'running' | 'failed'
  agent_id: string
  trigger_msg_id: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  agents: { name: string; provider: string } | null
}

export function useAgentRuns(roomId: string, refreshSignal?: number) {
  const [runs, setRuns] = useState<DbAgentRun[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRuns = useCallback(() => {
    const supabase = createSupabaseBrowserClient()
    supabase
      .from('agent_runs')
      .select('id, status, agent_id, trigger_msg_id, error_message, created_at, updated_at, agents(name, provider)')
      .eq('room_id', roomId)
      .in('status', ['queued', 'running', 'failed'])
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setRuns((data as unknown as DbAgentRun[]) ?? [])
        setLoading(false)
      })
  }, [roomId])

  // Refetch on mount and when refreshSignal changes (user sent a message)
  useEffect(() => {
    fetchRuns()
  }, [fetchRuns, refreshSignal])

  // Realtime: refetch on any agent_runs change for this room
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`agent-runs-rt-${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_runs', filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string }).id
            if (oldId) setRuns((prev) => prev.filter((run) => run.id !== oldId))
            return
          }
          fetchRuns()
        }
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [roomId, fetchRuns])

  return { runs, loading }
}
