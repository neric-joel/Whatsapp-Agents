'use client'
import { useState, useCallback, useEffect } from 'react'
import RoomHeader from '@/components/RoomHeader'
import MessageTimeline from '@/components/MessageTimeline'
import ComposeBox from '@/components/ComposeBox'
import PinnedItemsPanel from '@/components/PinnedItemsPanel'
import { subscribeToChatCleared } from '@/lib/chat-events'
import type { OptimisticMessage, ReplyingMessage } from '@/components/MessageTimeline'

export default function RoomPage({ params }: { params: { roomId: string } }) {
  const { roomId } = params
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [optimistic, setOptimistic] = useState<OptimisticMessage[]>([])
  const [replyingTo, setReplyingTo] = useState<ReplyingMessage | null>(null)

  const handleOptimistic = useCallback((msg: OptimisticMessage) => {
    setOptimistic((prev) => [...prev, msg])
  }, [])

  const handleRefetch = useCallback(() => {
    setRefreshSignal((s) => s + 1)
    setOptimistic([])
  }, [])

  useEffect(() => subscribeToChatCleared(roomId, handleRefetch), [roomId, handleRefetch])

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <RoomHeader roomId={roomId} />
        <MessageTimeline
          roomId={roomId}
          refreshSignal={refreshSignal}
          optimisticMessages={optimistic}
          onReply={setReplyingTo}
        />
        <ComposeBox
          roomId={roomId}
          onOptimistic={handleOptimistic}
          onRefetch={handleRefetch}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      </div>
      <aside className="hidden w-72 flex-shrink-0 border-l border-[var(--border)] bg-[var(--right-panel)] lg:block">
        <div className="border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm font-medium text-[var(--text)]">
          Pinned
        </div>
        <PinnedItemsPanel roomId={roomId} />
      </aside>
    </div>
  )
}
