'use client'
import { useState, useCallback } from 'react'
import RoomHeader from '@/components/RoomHeader'
import MessageTimeline from '@/components/MessageTimeline'
import ComposeBox from '@/components/ComposeBox'
import PinnedItemsPanel from '@/components/PinnedItemsPanel'
import type { OptimisticMessage } from '@/components/MessageTimeline'

export default function RoomPage({ params }: { params: { roomId: string } }) {
  const { roomId } = params
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([])

  const handleOptimistic = useCallback((msg: OptimisticMessage) => {
    setOptimistic((prev) => [...prev, msg])
  }, [])

  const handleRefetch = useCallback(() => {
    setRefreshSignal((s) => s + 1)
    setOptimistic([])
  }, [])

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
      <aside className="hidden w-72 flex-shrink-0 border-l border-[#27272a] bg-[#09090b] lg:block">
        <div className="border-b border-[#27272a] px-4 py-3 text-sm font-medium text-[#f4f4f5]">
          Pinned
        </div>
        <PinnedItemsPanel roomId={roomId} />
      </aside>
    </div>
  )
}
