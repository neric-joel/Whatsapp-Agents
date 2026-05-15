'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface Props {
  roomId: string
}

interface AgentSummary {
  id: string
  name: string
  slug: string
  provider: string
  adapter_type: string
  is_active: boolean
}

interface RoomAgentMember {
  id: string
  agent_id: string
  muted: boolean
  reply_enabled: boolean
  last_run_status: string | null
  agent: AgentSummary
}

export default function RoomHeader({ roomId }: Props) {
  const [roomName, setRoomName] = useState<string | null>(null)
  const [agentCount, setAgentCount] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const [members, setMembers] = useState<RoomAgentMember[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    Promise.all([
      supabase.from('rooms').select('name').eq('id', roomId).single(),
      supabase
        .from('room_members')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', roomId)
        .eq('member_type', 'agent'),
    ]).then(([roomRes, membersRes]) => {
      if (roomRes.data) setRoomName((roomRes.data as { name: string }).name)
      if (membersRes.count != null) setAgentCount(membersRes.count)
    })
  }, [roomId])

  function selectFirstAvailableAgent(nextAgents: AgentSummary[], nextMembers: RoomAgentMember[]) {
    const memberAgentIds = new Set(nextMembers.map((member) => member.agent_id))
    const firstAvailable = nextAgents.find((agent) => !memberAgentIds.has(agent.id))
    setSelectedAgentId(firstAvailable?.id ?? '')
  }

  async function fetchAgentPanelData() {
    setLoadingAgents(true)
    setAgentError(null)
    try {
      const [membersRes, agentsRes] = await Promise.all([
        fetch(`/api/rooms/${roomId}/members`),
        fetch('/api/agents'),
      ])
      const membersJson = await membersRes.json().catch(() => ({})) as {
        ok?: boolean
        data?: RoomAgentMember[]
        error?: { message?: string }
      }
      const agentsJson = await agentsRes.json().catch(() => ({})) as {
        ok?: boolean
        data?: AgentSummary[]
        error?: { message?: string }
      }

      if (!membersRes.ok || !membersJson.ok || !membersJson.data) {
        setAgentError(membersJson.error?.message ?? 'Failed to load room agents')
        return
      }
      if (!agentsRes.ok || !agentsJson.ok || !agentsJson.data) {
        setAgentError(agentsJson.error?.message ?? 'Failed to load agents')
        return
      }

      setMembers(membersJson.data)
      setAgents(agentsJson.data)
      setAgentCount(membersJson.data.length)
      selectFirstAvailableAgent(agentsJson.data, membersJson.data)
    } finally {
      setLoadingAgents(false)
    }
  }

  useEffect(() => {
    if (!panelOpen) return
    void fetchAgentPanelData()
  }, [panelOpen, roomId])

  async function updateMember(member: RoomAgentMember, muted: boolean) {
    setBusyMemberId(member.id)
    setAgentError(null)
    try {
      const res = await fetch(`/api/rooms/${roomId}/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted }),
      })
      const json = await res.json().catch(() => ({})) as {
        ok?: boolean
        data?: RoomAgentMember
        error?: { message?: string }
      }
      if (!res.ok || !json.ok || !json.data) {
        setAgentError(json.error?.message ?? 'Failed to update agent')
        return
      }
      const updated = json.data
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, ...updated } : item))
    } finally {
      setBusyMemberId(null)
    }
  }

  async function removeMember(member: RoomAgentMember) {
    setBusyMemberId(member.id)
    setAgentError(null)
    try {
      const res = await fetch(`/api/rooms/${roomId}/members/${member.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: { message?: string } }
      if (!res.ok || !json.ok) {
        setAgentError(json.error?.message ?? 'Failed to remove agent')
        return
      }
      setMembers((current) => {
        const next = current.filter((item) => item.id !== member.id)
        setAgentCount(next.length)
        selectFirstAvailableAgent(agents, next)
        return next
      })
    } finally {
      setBusyMemberId(null)
    }
  }

  async function addAgent() {
    if (!selectedAgentId) return
    setBusyMemberId('__add__')
    setAgentError(null)
    try {
      const res = await fetch(`/api/rooms/${roomId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selectedAgentId }),
      })
      const json = await res.json().catch(() => ({})) as {
        ok?: boolean
        data?: RoomAgentMember
        error?: { message?: string }
      }
      if (!res.ok || !json.ok || !json.data) {
        setAgentError(json.error?.message ?? 'Failed to add agent')
        return
      }
      const added = json.data
      setMembers((current) => {
        const next = [...current, added]
        setAgentCount(next.length)
        selectFirstAvailableAgent(agents, next)
        return next
      })
    } finally {
      setBusyMemberId(null)
    }
  }

  const currentAgentIds = new Set(members.map((member) => member.agent_id))
  const availableAgents = agents.filter((agent) => !currentAgentIds.has(agent.id))

  return (
    <header className="relative flex h-14 flex-shrink-0 items-center border-b border-gray-200 bg-white px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <h1 className="truncate text-lg font-semibold text-gray-900"># {roomName ?? '...'}</h1>
        <span className="h-5 w-px bg-gray-200" aria-hidden="true" />
        <span className="text-sm text-gray-500">{agentCount} agents</span>
      </div>

      <button
        type="button"
        onClick={() => setPanelOpen((open) => !open)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
        aria-label="Manage agents"
        aria-expanded={panelOpen}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 .9-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5.9h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      </button>

      {panelOpen && (
        <div className="absolute right-4 top-14 z-50 w-[360px] max-w-[calc(100vw-2rem)] border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2">
            <span className="text-sm font-semibold text-gray-900">Agents</span>
            <button
              type="button"
              onClick={() => void fetchAgentPanelData()}
              disabled={loadingAgents}
              className="text-xs text-gray-500 transition-colors hover:text-gray-900 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>

          <div className="max-h-[320px] overflow-y-auto py-1">
            {loadingAgents && members.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-500">Loading agents...</p>
            ) : members.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-500">No agents in this room.</p>
            ) : (
              members.map((member) => {
                const failed = member.last_run_status === 'failed'
                const statusClass = failed
                  ? 'bg-red-500'
                  : member.muted || !member.agent.is_active
                    ? 'bg-gray-400'
                    : 'bg-emerald-500'
                return (
                  <div key={member.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50">
                    <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${statusClass}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-900">{member.agent.name}</div>
                      <div className="truncate text-xs text-gray-500">@{member.agent.slug} / {member.agent.provider}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void updateMember(member, !member.muted)}
                      disabled={busyMemberId === member.id}
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
                    >
                      {member.muted ? 'Unmute' : 'Mute'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeMember(member)}
                      disabled={busyMemberId === member.id}
                      className="h-7 w-7 rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
                      aria-label={`Remove ${member.agent.name}`}
                    >
                      &times;
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {agentError && (
            <p className="border-t border-gray-200 px-3 py-2 text-xs text-red-600">{agentError}</p>
          )}

          <div className="flex items-center gap-2 border-t border-gray-200 p-3">
            <select
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              disabled={availableAgents.length === 0 || busyMemberId === '__add__'}
              className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 outline-none disabled:opacity-50"
            >
              {availableAgents.length === 0 ? (
                <option value="">All active agents added</option>
              ) : (
                availableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={() => void addAgent()}
              disabled={!selectedAgentId || busyMemberId === '__add__'}
              className="rounded-md bg-[#1264A3] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0b5c97] disabled:opacity-40"
            >
              Add agent
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
