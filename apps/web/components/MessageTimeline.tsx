'use client'

import { useEffect, useRef, useState } from 'react'

import { useAgentRuns } from '@/hooks/useAgentRuns'
import { useMessages } from '@/hooks/useMessages'
import { useToolCalls } from '@/hooks/useToolCalls'
import { applyPinnedItemChange, buildPinsByMessageId, type PinMessageRow } from '@/lib/pins'
import { buildTimelineEvents } from '@/lib/timeline-events'

import AgentRunCard from './AgentRunCard'
import FileAttachmentCard from './FileAttachmentCard'
import MessageBubble from './MessageBubble'
import ToolCallCard from './ToolCallCard'

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

interface PinnedItemRow extends PinMessageRow {
  room_id: string
  sort_order: number
}

interface Props {
  roomId: string
  refreshSignal?: number
  optimisticMessages?: OptimisticMessage[]
  onReply?: (message: ReplyingMessage) => void
}

function LoadingSkeleton() {
  return (
    <div
      className="space-y-5 px-5 py-6"
      role="status"
      aria-live="polite"
      aria-label="Loading messages"
    >
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

export default function MessageTimeline({
  roomId,
  refreshSignal,
  optimisticMessages = [],
  onReply,
}: Props) {
  const { messages, loading, refetch } = useMessages(roomId, refreshSignal)
  const { runs, refetch: refetchRuns } = useAgentRuns(roomId, refreshSignal)
  const toolCalls = useToolCalls(roomId, refreshSignal)
  const [filesMap, setFilesMap] = useState<Record<string, FileRow>>({})
  const [currentUserName, setCurrentUserName] = useState<string | null>(null)
  const [pinsByMessageId, setPinsByMessageId] = useState<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Honour prefers-reduced-motion: ScrollIntoViewOptions.behavior overrides
    // the CSS scroll-behavior, so we must branch in JS (not only in CSS).
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [messages, optimisticMessages])

  useEffect(() => {
    // Local single-user app — the human is always "You".
    setCurrentUserName('You')
  }, [])

  useEffect(() => {
    const fileIds = messages.flatMap((m) => {
      const ids = (m.metadata as { file_ids?: unknown }).file_ids
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    })
    const missingIds = [...new Set(fileIds)].filter((id) => !filesMap[id])
    if (missingIds.length === 0) return

    fetch(`/api/rooms/${roomId}/files`)
      .then((res) => res.json())
      .then((json) => {
        const rows = (json?.data as FileRow[]) ?? []
        setFilesMap((prev) => ({
          ...prev,
          ...Object.fromEntries(rows.map((file) => [file.id, file])),
        }))
      })
      .catch(() => {})
  }, [messages, filesMap, roomId])

  useEffect(() => {
    let mounted = true
    const loadPins = () => {
      fetch(`/api/rooms/${roomId}/pins`)
        .then(async (res) => {
          const json = (await res.json()) as {
            ok: boolean
            data?: PinnedItemRow[]
            error?: { message?: string }
          }
          if (!res.ok || !json.ok) throw new Error(json.error?.message ?? 'Failed to load pins')
          return json.data ?? []
        })
        .then((pins) => {
          if (mounted) setPinsByMessageId(buildPinsByMessageId(pins))
        })
        .catch(() => {
          /* transient; the next poll retries (replaces the old realtime channel) */
        })
    }
    loadPins()
    const t = setInterval(loadPins, 2000)
    return () => {
      mounted = false
      clearInterval(t)
    }
  }, [roomId])

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--surface)]">
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
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean
      data?: PinnedItemRow
    } | null
    if (!res.ok || !json?.ok || !json.data) throw new Error('Failed to pin message')
    const pin = json.data
    setPinsByMessageId((prev) => applyPinnedItemChange(prev, pin))
  }

  async function handleUnpin(messageId: string, pinId: string) {
    const res = await fetch(`/api/pins/${pinId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    })
    if (!res.ok) throw new Error('Failed to unpin message')
    setPinsByMessageId((prev) => {
      const next = { ...prev }
      if (next[messageId] === pinId) delete next[messageId]
      return next
    })
  }

  async function handleCancelRun(runId: string) {
    await fetch(`/api/agent-runs/${runId}/cancel`, { method: 'POST' })
    refetchRuns()
  }

  return (
    <div
      className="flex-1 overflow-y-auto bg-[var(--surface)]"
      data-testid="message-timeline"
      role="log"
      aria-label="Message timeline"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="min-h-full py-4">
        {allMessages.length === 0 && runs.length === 0 && !loading && (
          // No role="status" here: this lives inside the role="log" live region,
          // so a separate status region would double-announce.
          <div className="flex min-h-full items-center justify-center p-8 text-center">
            <div>
              <p className="text-sm text-[var(--muted)]">No messages yet</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Say something to get the agents started.
              </p>
            </div>
          </div>
        )}
        {timelineEvents.map((event) => {
          if (event.type === 'run') {
            return (
              <AgentRunCard
                key={event.id}
                run={event.run}
                onCancel={(runId) => {
                  void handleCancelRun(runId)
                }}
              />
            )
          }

          const msg = event.message
          const ids = (msg.metadata as { file_ids?: unknown }).file_ids
          const fileIds = Array.isArray(ids)
            ? ids.filter((id): id is string => typeof id === 'string')
            : []
          return (
            <MessageBubble
              key={event.id}
              message={msg}
              roomId={roomId}
              currentUserName={currentUserName}
              pinId={pinsByMessageId[msg.id] ?? null}
              onPin={handlePin}
              onUnpin={handleUnpin}
              onReply={onReply}
              onDeleted={refetch}
              onHallucinationDismiss={refetch}
            >
              {fileIds.map((fileId) =>
                filesMap[fileId] ? (
                  <FileAttachmentCard key={fileId} file={filesMap[fileId]} />
                ) : null,
              )}
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
