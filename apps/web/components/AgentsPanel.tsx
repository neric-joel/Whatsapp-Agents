'use client'
import { useCallback, useEffect, useState } from 'react'

import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface AgentRow {
  agent_id: string
  muted: boolean
  reply_enabled: boolean
  agents: {
    id: string
    name: string
    slug: string
    capabilities: string | null
    is_active: boolean
  } | null
}

interface Props {
  roomId: string
}

/** ComposeBox dispatches this when the user types `/agents`. */
export const AGENTS_EVENT = 'agentroom:agents'

const ACTIVE_RUN_STATUSES = ['queued', 'claimed', 'running']

export default function AgentsPanel({ roomId }: Props) {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [activeByAgent, setActiveByAgent] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createSupabaseBrowserClient()
      const { data, error: err } = await supabase
        .from('room_members')
        .select(
          'agent_id, muted, reply_enabled, agents!inner(id, name, slug, capabilities, is_active)',
        )
        .eq('room_id', roomId)
        .eq('member_type', 'agent')
      if (err) throw err
      const rows = ((data ?? []) as unknown as AgentRow[]).filter((r) => r.agents?.is_active)
      setAgents(rows)

      const { data: runs } = await supabase
        .from('agent_runs')
        .select('agent_id, status')
        .eq('room_id', roomId)
        .in('status', ACTIVE_RUN_STATUSES)
      const counts: Record<string, number> = {}
      for (const run of (runs ?? []) as Array<{ agent_id: string }>) {
        counts[run.agent_id] = (counts[run.agent_id] ?? 0) + 1
      }
      setActiveByAgent(counts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    void load()
  }, [load])

  // Refresh on the `/agents` command and on live run-status changes.
  useEffect(() => {
    function onAgents() {
      void load()
    }
    window.addEventListener(AGENTS_EVENT, onAgents)
    const supabase = createSupabaseBrowserClient()
    const sub = supabase
      .channel(`agents-runs:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_runs', filter: `room_id=eq.${roomId}` },
        () => void load(),
      )
      .subscribe()
    return () => {
      window.removeEventListener(AGENTS_EVENT, onAgents)
      void sub.unsubscribe()
    }
  }, [roomId, load])

  if (error)
    return (
      <div role="alert" className="p-4 text-red-600 text-sm">
        Failed to load agents
      </div>
    )
  if (loading)
    return (
      <div role="status" className="p-4 text-[var(--muted)] text-sm">
        Loading agents…
      </div>
    )
  if (agents.length === 0)
    return (
      <div role="status" className="p-4 text-[var(--muted)] text-xs text-center">
        No agents in this room yet.
      </div>
    )

  return (
    <ul className="space-y-2 px-3 py-2">
      {agents.map((row) => {
        const a = row.agents!
        const active = activeByAgent[row.agent_id] ?? 0
        return (
          <li
            key={row.agent_id}
            className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-sm"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-[var(--text)]">
                {a.name} <span className="text-[var(--muted)]">@{a.slug}</span>
              </span>
              {active > 0 ? (
                <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-text)]">
                  {active} active
                </span>
              ) : row.muted ? (
                <span className="text-[10px] text-[var(--muted)]">muted</span>
              ) : null}
            </div>
            {a.capabilities && (
              <div className="text-xs leading-5 text-[var(--muted)]">{a.capabilities}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
