'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface AgentRow {
  id: string
  name: string
  slug: string
  provider: string
}

interface RoomMemberRow {
  agents: AgentRow | null
}

interface Props {
  roomId: string
}

export default function AgentsPanel({ roomId }: Props) {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    setLoading(true)

    const supabase = createSupabaseBrowserClient()
    void supabase
      .from('room_members')
      .select('agents(id, name, slug, provider)')
      .eq('room_id', roomId)
      .eq('member_type', 'agent')
      .then(({ data }) => {
        if (!mounted) return
        const rows = (data as unknown as RoomMemberRow[] | null) ?? []
        setAgents(rows.map((row) => row.agents).filter((agent): agent is AgentRow => Boolean(agent)))
        setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [roomId])

  return (
    <section className="border-b border-[#27272a]">
      <div className="border-b border-[#27272a] px-3 py-2 text-xs font-medium uppercase tracking-widest text-[#71717a]">
        Agents
      </div>
      <div className="space-y-2 p-3">
        {loading ? (
          <p className="text-xs text-[#52525b]">Loading agents...</p>
        ) : agents.length === 0 ? (
          <div className="space-y-2 text-center">
            <p className="text-xs text-[#52525b]">No agents in this room yet.</p>
            <button
              type="button"
              disabled
              className="cursor-default rounded border border-[#27272a] px-2 py-1 text-xs text-[#71717a]"
            >
              Use Manage Agents ↑
            </button>
          </div>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} className="rounded-lg border border-[#27272a] bg-[#18181b] p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#f4f4f5]">{agent.name}</p>
                  <p className="truncate text-xs text-[#71717a]">@{agent.slug}</p>
                </div>
                <span className="flex-shrink-0 rounded-full border border-[#27272a] px-2 py-0.5 text-[11px] text-[#71717a]">
                  {agent.provider}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
