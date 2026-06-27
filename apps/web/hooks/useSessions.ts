'use client'
import type { Session } from '@agentroom/shared'
import { useCallback, useEffect, useState } from 'react'

/**
 * Cowork-style sessions (working contexts bound to a folder). The first session is the
 * active one (the API orders by last_active_at). Single-user local app: no auth needed.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/sessions')
      const json = (await res.json()) as {
        ok: boolean
        data?: Session[]
        error?: { message?: string }
      }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to load sessions')
      setSessions(json.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createSession = useCallback(
    async (workingDir: string, name?: string) => {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ working_dir: workingDir, ...(name ? { name } : {}) }),
      })
      const json = (await res.json()) as {
        ok: boolean
        data?: Session
        error?: { message?: string }
      }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to create session')
      await refresh()
      return json.data!
    },
    [refresh],
  )

  const updateSession = useCallback(
    async (id: string, patch: { name?: string; touch?: boolean }) => {
      const res = await fetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to update session')
      await refresh()
    },
    [refresh],
  )

  const active = sessions[0] ?? null
  return { sessions, active, loading, error, refresh, createSession, updateSession }
}
