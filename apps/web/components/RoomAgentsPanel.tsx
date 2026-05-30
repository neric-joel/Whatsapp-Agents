'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getApiErrorMessage } from '@/lib/api-client'

interface AgentSummary {
  id: string
  slug: string
  name: string
}

interface RoomMemberRow {
  id: string
  member_type: 'user' | 'agent'
  agent_id: string | null
  agents: AgentSummary | null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: unknown }

interface Props {
  roomId: string
  open: boolean
  onClose: () => void
  onChanged: () => void
}

export default function RoomAgentsPanel({ roomId, open, onClose, onChanged }: Props) {
  const [members, setMembers] = useState<RoomMemberRow[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const agentMembers = useMemo(
    () => members.filter((member) => member.member_type === 'agent' && member.agent_id),
    [members],
  )

  const availableAgents = useMemo(() => {
    const memberAgentIds = new Set(agentMembers.map((member) => member.agent_id))
    return agents.filter((agent) => !memberAgentIds.has(agent.id))
  }, [agentMembers, agents])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [membersRes, agentsRes] = await Promise.all([
        fetch(`/api/rooms/${roomId}/members`, { credentials: 'same-origin' }),
        fetch('/api/agents', { credentials: 'same-origin' }),
      ])
      const membersPayload = (await membersRes.json().catch(() => null)) as ApiResponse<RoomMemberRow[]> | null
      const agentsPayload = (await agentsRes.json().catch(() => null)) as ApiResponse<AgentSummary[]> | null

      if (!membersRes.ok || !membersPayload?.ok) {
        throw new Error(getApiErrorMessage(membersPayload, 'Failed to load room members'))
      }
      if (!agentsRes.ok || !agentsPayload?.ok) {
        throw new Error(getApiErrorMessage(agentsPayload, 'Failed to load agents'))
      }

      setMembers(membersPayload.data)
      setAgents(agentsPayload.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    if (!open) return
    void loadData()
  }, [loadData, open])

  const addAgent = async (agentId: string) => {
    setBusyId(agentId)
    setError(null)

    try {
      const res = await fetch(`/api/rooms/${roomId}/members`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      })
      const payload = (await res.json().catch(() => null)) as ApiResponse<RoomMemberRow> | null

      if (!res.ok || !payload?.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to add agent'))
      }

      setMembers((current) => [...current, payload.data])
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add agent')
    } finally {
      setBusyId(null)
    }
  }

  const removeMember = async (memberId: string) => {
    setBusyId(memberId)
    setError(null)

    try {
      const res = await fetch(`/api/rooms/${roomId}/members/${memberId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const payload = (await res.json().catch(() => null)) as ApiResponse<{ deleted: true }> | null

      if (!res.ok || !payload?.ok) {
        throw new Error(getApiErrorMessage(payload, 'Failed to remove agent'))
      }

      setMembers((current) => current.filter((member) => member.id !== memberId))
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove agent')
    } finally {
      setBusyId(null)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage agents"
        className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-lg border border-[#27272a] bg-[#18181b] shadow-2xl"
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className="flex items-center border-b border-[#27272a] px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold text-[#f4f4f5]">Manage Agents</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-[#71717a] transition hover:bg-[#27272a] hover:text-[#f4f4f5]"
            aria-label="Close"
            title="Close"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[calc(80vh-57px)] overflow-y-auto p-4">
          {error && <p className="mb-3 rounded bg-red-950/40 px-3 py-2 text-xs text-red-200">{error}</p>}
          {loading ? (
            <p className="py-6 text-center text-sm text-[#71717a]">Loading agents...</p>
          ) : (
            <div className="space-y-5">
              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-[#71717a]">
                  In This Room
                </h3>
                <div className="space-y-2">
                  {agentMembers.length === 0 && (
                    <p className="rounded border border-dashed border-[#27272a] px-3 py-4 text-sm text-[#71717a]">
                      No agents added.
                    </p>
                  )}
                  {agentMembers.map((member) => (
                    <div key={member.id} className="flex items-center gap-3 rounded border border-[#27272a] px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#f4f4f5]">
                          {member.agents?.name ?? 'Unknown agent'}
                        </p>
                        <p className="truncate text-xs text-[#71717a]">@{member.agents?.slug ?? member.agent_id}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { void removeMember(member.id) }}
                        disabled={busyId === member.id}
                        className="rounded border border-[#3f3f46] px-2 py-1 text-xs text-[#d4d4d8] transition hover:border-red-500/70 hover:bg-red-950/40 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyId === member.id ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-[#71717a]">
                  Available Agents
                </h3>
                <div className="space-y-2">
                  {availableAgents.length === 0 && (
                    <p className="rounded border border-dashed border-[#27272a] px-3 py-4 text-sm text-[#71717a]">
                      No available agents.
                    </p>
                  )}
                  {availableAgents.map((agent) => (
                    <div key={agent.id} className="flex items-center gap-3 rounded border border-[#27272a] px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#f4f4f5]">{agent.name}</p>
                        <p className="truncate text-xs text-[#71717a]">@{agent.slug}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { void addAgent(agent.id) }}
                        disabled={busyId === agent.id}
                        className="rounded bg-[#8b5cf6] px-3 py-1 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyId === agent.id ? 'Adding...' : 'Add'}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
