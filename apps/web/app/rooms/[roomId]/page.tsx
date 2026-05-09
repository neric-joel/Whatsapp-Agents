'use client'
import { useState, useCallback } from 'react'
import RoomHeader from '@/components/RoomHeader'
import MessageTimeline from '@/components/MessageTimeline'
import ComposeBox from '@/components/ComposeBox'
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
    <>
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
    </>
  )
}
