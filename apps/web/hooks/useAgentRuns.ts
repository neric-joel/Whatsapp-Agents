'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export interface DbAgentRun {
  id: string
  status: 'queued' | 'running'
  agent_id: string
  agents: { name: string; provider: string } | null
}

export function useAgentRuns(roomId: string) {
  const [runs, setRuns] = useState<DbAgentRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase
      .from('agent_runs')
      .select('id, status, agent_id, agents(name, provider)')
      .eq('room_id', roomId)
      .in('status', ['queued', 'running'])
      .then(({ data }) => {
        setRuns((data as unknown as DbAgentRun[]) ?? [])
        setLoading(false)
      })
  }, [roomId])

  return { runs, loading }
}
