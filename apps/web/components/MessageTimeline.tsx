'use client'

import { useEffect, useRef, useState } from 'react'
import { useMessages } from '@/hooks/useMessages'
import { useAgentRuns } from '@/hooks/useAgentRuns'
import { useToolCalls } from '@/hooks/useToolCalls'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import MessageBubble from './MessageBubble'
import AgentRunCard from './AgentRunCard'
import ToolCallCard from './ToolCallCard'
import FileAttachmentCard from './FileAttachmentCard'
import { buildTimelineEvents } from '@/lib/timeline-events'

export interface OptimisticMessage {
  id: string
  content: string
  sender_type: 'user'
  created_at: string
  metadata?: Record<string, unknown>
  reply_to_id?: string | null
}

export interface ReplyingMessage {
  id: string
  content: string
  sender_type: string
  agents?: { name: string; provider: string } | null
}

interface FileRow {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
}

interface Props {
  roomId: string
  refreshSignal?: number
  optimisticMessages?: OptimisticMessage[]
  onReply?: (message: ReplyingMessage) => void
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5 px-5 py-6">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex animate-pulse items-start gap-3">
          <div className="h-8 w-8 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-28 rounded bg-gray-200" />
            <div className="h-16 max-w-xl rounded-xl bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MessageTimeline({ roomId, refreshSignal, optimisticMessages = [], onReply }: Props) {
  const { messages, loading, refetch } = useMessages(roomId, refreshSignal)
  const { runs } = useAgentRuns(roomId, refreshSignal)
  const toolCalls = useToolCalls(roomId)
  const [filesMap, setFilesMap] = useState<Record<string, FileRow>>({})
  const [currentUserName, setCurrentUserName] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, optimisticMessages])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserName(data.user?.email ?? null)
    })
  }, [])

  useEffect(() => {
    const fileIds = messages.flatMap((m) => {
      const ids = (m.metadata as { file_ids?: unknown }).file_ids
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    })
    const missingIds = [...new Set(fileIds)].filter((id) => !filesMap[id])
    if (missingIds.length === 0) return

    const supabase = createSupabaseBrowserClient()
    supabase
      .from('files')
      .select('id, filename, mime_type, size_bytes')
      .in('id', missingIds)
      .then(({ data }) => {
        const rows = (data as FileRow[]) ?? []
        setFilesMap((prev) => ({
          ...prev,
          ...Object.fromEntries(rows.map((file) => [file.id, file])),
        }))
      })
  }, [messages, filesMap])

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto bg-white">
        <LoadingSkeleton />
      </div>
    )
  }

  const allMessages = [
    ...messages,
    ...optimisticMessages.map((m) => ({
      ...m,
      sender_user_id: null,
      sender_agent_id: null,
      reply_to_id: m.reply_to_id ?? null,
      agents: null,
      metadata: m.metadata ?? {},
    })),
  ]
  const timelineEvents = buildTimelineEvents(allMessages, runs)

  async function handlePin(messageId: string, content: string) {
    const res = await fetch(`/api/rooms/${roomId}/pins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_message_id: messageId,
        pin_type: 'context',
        title: content.slice(0, 80),
        content,
        visibility: 'primary',
      }),
    })
    if (!res.ok) throw new Error('Failed to pin message')
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="min-h-full py-4">
        {allMessages.length === 0 && runs.length === 0 && !loading && (
          <div className="flex min-h-full items-center justify-center p-8 text-center">
            <div>
              <p className="text-sm text-gray-500">No messages yet</p>
              <p className="mt-1 text-xs text-gray-400">Say something to get the agents started.</p>
            </div>
          </div>
        )}
        {timelineEvents.map((event) => {
          if (event.type === 'run') {
            return <AgentRunCard key={event.id} run={event.run} />
          }

          const msg = event.message
          const ids = (msg.metadata as { file_ids?: unknown }).file_ids
          const fileIds = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
          return (
            <MessageBubble
              key={event.id}
              message={msg}
              roomId={roomId}
              currentUserName={currentUserName}
              onPin={handlePin}
              onReply={onReply}
              onDeleted={refetch}
              onHallucinationDismiss={refetch}
            >
              {fileIds.map((fileId) => (
                filesMap[fileId] ? <FileAttachmentCard key={fileId} file={filesMap[fileId]} /> : null
              ))}
            </MessageBubble>
          )
        })}
        {toolCalls.length > 0 && (
          <div className="mt-3 border-t border-gray-200 pt-3">
            {toolCalls.map((tc) => (
              <ToolCallCard
                key={tc.id}
                toolCall={tc}
                onApprove={() => void fetch(`/api/tool-calls/${tc.id}/approve`, { method: 'POST' })}
                onDeny={() => void fetch(`/api/tool-calls/${tc.id}/deny`, { method: 'POST' })}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
