'use client'
import { useEffect, useRef } from 'react'
import { useMessages } from '@/hooks/useMessages'
import { useAgentRuns } from '@/hooks/useAgentRuns'
import MessageBubble from './MessageBubble'
import AgentRunCard from './AgentRunCard'

export interface OptimisticMessage {
  id: string
  content: string
  sender_type: 'user'
  created_at: string
}

interface Props {
  roomId: string
  refreshSignal?: number
  optimisticMessages?: OptimisticMessage[]
}

export default function MessageTimeline({ roomId, refreshSignal, optimisticMessages = [] }: Props) {
  const { messages, loading } = useMessages(roomId, refreshSignal)
  const { runs } = useAgentRuns(roomId)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, optimisticMessages, runs])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[#52525b] text-sm">Loading...</span>
      </div>
    )
  }

  const allMessages = [
    ...messages,
    ...optimisticMessages.map((m) => ({ ...m, sender_agent_id: null, agents: null })),
  ]

  return (
    <div className="flex-1 overflow-y-auto py-4">
      {allMessages.length === 0 && runs.length === 0 && (
        <div className="flex items-center justify-center h-full">
          <p className="text-[#52525b] text-sm">No messages yet. Say hello!</p>
        </div>
      )}
      {allMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {runs.map((run) => (
        <AgentRunCard key={run.id} run={run} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
