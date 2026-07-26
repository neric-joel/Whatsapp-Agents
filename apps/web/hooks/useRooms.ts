'use client'
import type { Room } from '@agentroom/shared'
import { useCallback, useEffect, useState } from 'react'

interface RoomsSnapshot {
  rooms: Room[]
  loading: boolean
  error: string | null
}

const subscribers = new Set<() => void>()
let snapshot: RoomsSnapshot = { rooms: [], loading: true, error: null }
let pendingRefresh: Promise<void> | null = null

function emitRooms() {
  for (const subscriber of subscribers) subscriber()
}

function setSnapshot(next: Partial<RoomsSnapshot>) {
  snapshot = { ...snapshot, ...next }
  emitRooms()
}

async function refreshRoomsSnapshot() {
  if (pendingRefresh) return pendingRefresh

  setSnapshot({ loading: true })
  pendingRefresh = (async () => {
    try {
      const res = await fetch('/api/rooms', { cache: 'no-store' })
      const json = await res.json()
      if (!json.ok) setSnapshot({ error: json.error?.message ?? 'Failed to load rooms' })
      else {
        setSnapshot({
          rooms: (json.data as Room[]) ?? [],
          error: null,
        })
      }
    } catch (e) {
      setSnapshot({ error: e instanceof Error ? e.message : 'Failed to load rooms' })
    } finally {
      setSnapshot({ loading: false })
      pendingRefresh = null
    }
  })()

  return pendingRefresh
}

/**
 * The room list. Local app: reads the GET API on demand (refreshRooms is called
 * after create/archive). No polling; callers share one cache so sidebar refreshes
 * update other mounted room consumers.
 */
export function useRooms() {
  const [state, setState] = useState(snapshot)

  const refreshRooms = useCallback(async () => {
    await refreshRoomsSnapshot()
  }, [])

  useEffect(() => {
    const subscriber = () => setState(snapshot)
    subscribers.add(subscriber)
    if (snapshot.loading && !pendingRefresh) void refreshRoomsSnapshot()
    return () => {
      subscribers.delete(subscriber)
    }
  }, [])

  return { ...state, refreshRooms }
}
