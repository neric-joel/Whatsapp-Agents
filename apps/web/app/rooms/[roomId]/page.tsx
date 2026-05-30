'use client'
import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import RoomHeader from '@/components/RoomHeader'
import MessageTimeline from '@/components/MessageTimeline'
import ComposeBox from '@/components/ComposeBox'
import AgentsPanel from '@/components/AgentsPanel'
import ActiveRunsPanel from '@/components/ActiveRunsPanel'
import PinnedItemsPanel from '@/components/PinnedItemsPanel'
import FilesPanel from '@/components/FilesPanel'
import type { OptimisticMessage } from '@/components/MessageTimeline'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function RoomPage({ params }: { params: { roomId: string } }) {
  const { roomId } = params
  const router = useRouter()
  const [hasSession, setHasSession] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([])

  useEffect(() => {
    let mounted = true
    const supabase = createSupabaseBrowserClient()

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return

      if (!data.session) {
        router.replace('/login')
        return
      }

      setHasSession(true)
      setCheckingSession(false)
    })

    return () => {
      mounted = false
    }
  }, [router])

  const handleOptimistic = useCallback((msg: OptimisticMessage) => {
    setOptimistic((prev) => [...prev, msg])
  }, [])

  const handleRefetch = useCallback(() => {
    setRefreshSignal((s) => s + 1)
    setOptimistic([])
  }, [])

  if (checkingSession || !hasSession) return null

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <RoomHeader roomId={roomId} />
        <MessageTimeline
          roomId={roomId}
          refreshSignal={refreshSignal}
          optimisticMessages={optimistic}
        />
        <ComposeBox
          roomId={roomId}
          onOptimistic={handleOptimistic}
          onRefetch={handleRefetch}
        />
      </div>
      <aside className="hidden w-72 flex-shrink-0 overflow-y-auto border-l border-[#27272a] bg-[#09090b] lg:block">
        <AgentsPanel roomId={roomId} />
        <ActiveRunsPanel roomId={roomId} />
        <PinnedItemsPanel roomId={roomId} />
        <FilesPanel roomId={roomId} />
      </aside>
    </div>
  )
}
