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

export interface OptimisticMessage {
  id: string
  content: string
  sender_type: 'user'
  created_at: string
  metadata?: Record<string, unknown>
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
}

export default function MessageTimeline({ roomId, refreshSignal, optimisticMessages = [] }: Props) {
  const { messages, loading } = useMessages(roomId, refreshSignal)
  const { runs } = useAgentRuns(roomId, refreshSignal)
  const toolCalls = useToolCalls(roomId)
  const [filesMap, setFilesMap] = useState<Record<string, FileRow>>({})
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, optimisticMessages, runs])

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
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[#52525b] text-sm">Loading...</span>
      </div>
    )
  }

  const allMessages = [
    ...messages,
    ...optimisticMessages.map((m) => ({ ...m, sender_agent_id: null, agents: null, metadata: m.metadata ?? {} })),
  ]

  async function handlePin(messageId: string, content: string) {
    await fetch(`/api/rooms/${roomId}/pins`, {
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
  }

  return (
    <div className="flex-1 overflow-y-auto py-4">
      {allMessages.length === 0 && runs.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
          <p className="text-[#52525b] text-sm">No messages yet</p>
          <p className="text-[#3f3f46] text-xs mt-1">Say something to get the agents started.</p>
        </div>
      )}
      {allMessages.map((msg) => {
        const ids = (msg.metadata as { file_ids?: unknown }).file_ids
        const fileIds = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
        return (
          <MessageBubble key={msg.id} message={msg} onPin={handlePin}>
            {fileIds.map((fileId) => (
              filesMap[fileId] ? <FileAttachmentCard key={fileId} file={filesMap[fileId]} /> : null
            ))}
          </MessageBubble>
        )
      })}
      {runs.map((run) => (
        <AgentRunCard key={run.id} run={run} />
      ))}
      {toolCalls.length > 0 && (
        <div className="mt-3 border-t border-[#27272a] pt-3">
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
  )
}
