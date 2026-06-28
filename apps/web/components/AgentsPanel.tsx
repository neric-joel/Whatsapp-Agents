'use client'
import { useCallback, useEffect, useState } from 'react'

import { type AgentRow, mapMembersToAgentRows, type MemberRow } from '../lib/agents-panel'
import CreateAgentForm from './CreateAgentForm'

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
  const [busyMember, setBusyMember] = useState<string | null>(null)
  // Local single-user app: the current user is always present and is the owner/admin.
  const [isAdmin] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/rooms/${roomId}/members`)
      if (!res.ok) throw new Error('Failed to load agents')
      const json = await res.json()
      const members = (json.data ?? []) as MemberRow[]
      const rows: AgentRow[] = mapMembersToAgentRows(members)
      setAgents(rows)

      const counts: Record<string, number> = {}
      for (const row of rows) {
        if (row.last_run_status && ACTIVE_RUN_STATUSES.includes(row.last_run_status)) {
          counts[row.agent_id] = (counts[row.agent_id] ?? 0) + 1
        }
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

  // Refresh on the `/agents` command and by polling the local API for live run-status changes.
  useEffect(() => {
    function onAgents() {
      void load()
    }
    window.addEventListener(AGENTS_EVENT, onAgents)
    const interval = setInterval(() => void load(), 1500)
    return () => {
      window.removeEventListener(AGENTS_EVENT, onAgents)
      clearInterval(interval)
    }
  }, [roomId, load])

  async function disableAgent(agentId: string) {
    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' })
    if (res.ok) void load()
  }

  // Mute/unmute toggles whether this agent replies to new messages (server-enforced: the
  // fan-out query and the discussion orchestrator both skip muted members). Unmuting lets it
  // participate again without removing it from the room (unlike Disable).
  async function toggleMute(memberId: string, muted: boolean) {
    if (!memberId) return
    setBusyMember(memberId)
    try {
      const res = await fetch(`/api/rooms/${roomId}/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ muted: !muted }),
      })
      if (res.ok) await load()
    } finally {
      setBusyMember(null)
    }
  }

  return (
    <div>
      {isAdmin && <CreateAgentForm roomId={roomId} onCreated={load} />}
      {error ? (
        <div role="alert" className="p-4 text-sm text-red-600">
          Failed to load agents
        </div>
      ) : loading ? (
        <div role="status" className="p-4 text-sm text-[var(--muted)]">
          Loading agents…
        </div>
      ) : agents.length === 0 ? (
        <div role="status" className="p-4 text-center text-xs text-[var(--muted)]">
          No agents in this room yet.
        </div>
      ) : (
        <ul className="space-y-2 px-3 py-2">
          {agents.map((row) => {
            const a = row.agent!
            const active = activeByAgent[row.agent_id] ?? 0
            // Local single-user app: the current user owns everything.
            const ownedByMe = true
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
                {a.provider && (
                  <div className="text-xs leading-5 text-[var(--muted)]">
                    {a.adapter_type === 'cli' ? 'connected CLI' : a.provider}
                  </div>
                )}
                {ownedByMe && (
                  <div className="mt-1 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void toggleMute(row.member_id, row.muted)}
                      disabled={busyMember === row.member_id || !row.member_id}
                      aria-pressed={row.muted}
                      className="text-[10px] text-[var(--muted)] underline transition-colors hover:text-[var(--text)] disabled:opacity-50"
                    >
                      {row.muted ? 'Unmute' : 'Mute'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void disableAgent(a.id)}
                      className="text-[10px] text-[var(--muted)] underline transition-colors hover:text-red-600"
                    >
                      Disable
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
