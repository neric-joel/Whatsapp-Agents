'use client'

import { useState, type ReactNode } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { extractHallucination } from '@/lib/hallucination-detector'
import { DELETED_MESSAGE_CONTENT } from '@/lib/message-management'
import { getProviderStyle } from '@/lib/provider-styles'
import FormattedMessageContent from './FormattedMessageContent'
import HallucinationBanner from './HallucinationBanner'

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function avatarInitial(name: string | null | undefined) {
  return (name?.trim().charAt(0) || 'U').toUpperCase()
}

export interface MessageBubbleProps {
  message: {
    id: string
    content: string
    sender_type: string
    sender_user_id?: string | null
    created_at: string
    metadata?: Record<string, unknown>
    agents?: { name: string; provider: string } | null
  }
  children?: ReactNode
  roomId: string
  currentUserName?: string | null
  onPin?: (messageId: string, content: string) => void | Promise<void>
  onReply?: (message: MessageBubbleProps['message']) => void
  onDeleted?: () => void
  onHallucinationDismiss?: () => void
}

export default function MessageBubble({
  message,
  children,
  roomId,
  currentUserName,
  onPin,
  onReply,
  onDeleted,
  onHallucinationDismiss,
}: MessageBubbleProps) {
  const { content, sender_type, created_at, agents, metadata } = message
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { showToast } = useToast()
  const isDeleted = content === DELETED_MESSAGE_CONTENT || Boolean(metadata?.deleted_at)
  const hallucinationMeta = sender_type === 'agent' ? extractHallucination(metadata ?? {}) : null
  const hallucinationState =
    metadata?.hallucination && typeof metadata.hallucination === 'object'
      ? metadata.hallucination as { accepted?: boolean; flagged?: boolean }
      : null
  const isHallucinationRejected = hallucinationState?.accepted === false
  const showHallucinationBanner = Boolean(
    hallucinationState?.flagged && !hallucinationState.accepted && hallucinationMeta,
  )

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      showToast('Message copied', 'success')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('Failed to copy message', 'error')
    }
  }

  async function handlePin() {
    if (!onPin) return
    try {
      await onPin(message.id, content)
      showToast('Message pinned', 'success')
    } catch {
      showToast('Failed to pin message', 'error')
    }
  }

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/rooms/${roomId}/messages/${message.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: { message?: string } }
        showToast(json.error?.message ?? 'Failed to delete message', 'error')
        return
      }
      showToast('Message deleted', 'success')
      onDeleted?.()
    } catch {
      showToast('Failed to delete message', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const actionButtons = (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      {onReply && (
        <button
          type="button"
          onClick={() => onReply(message)}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
          Reply
        </button>
      )}
      {onPin && (
        <button
          type="button"
          onClick={() => void handlePin()}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
        >
          Pin
        </button>
      )}
      {sender_type === 'user' && !isDeleted && (
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deleting}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      )}
    </div>
  )

  if (sender_type === 'agent') {
    const providerStyle = getProviderStyle(agents?.provider)

    return (
      <div className="group flex animate-message-in flex-row items-start gap-3 px-5 py-2">
        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border ${providerStyle.avatar} ${providerStyle.border}`}>
          <span className="text-[11px] font-semibold text-white">
            {agents ? initials(agents.name) : 'AG'}
          </span>
        </div>
        <div className="flex max-w-[72%] flex-col">
          <div className="mb-1 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${providerStyle.nameColor}`}>
              <span className={`h-1 w-1 rounded-full ${providerStyle.dot}`} aria-hidden="true" />
              {agents?.name ?? 'Agent'}
            </span>
            <span className="text-xs text-gray-400">{formatTime(created_at)}</span>
          </div>
          <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 shadow-sm ${providerStyle.bubble} ${providerStyle.border} ${providerStyle.text} ${isHallucinationRejected ? 'line-through decoration-yellow-500 decoration-2' : ''}`}>
            {isDeleted ? (
              <span className="italic text-zinc-500">{DELETED_MESSAGE_CONTENT}</span>
            ) : (
              <FormattedMessageContent content={content} />
            )}
          </div>
          {showHallucinationBanner && hallucinationMeta && (
            <HallucinationBanner
              meta={hallucinationMeta}
              messageId={message.id}
              onDismiss={() => onHallucinationDismiss?.()}
            />
          )}
          {children}
          <div className="mt-1.5 flex items-center gap-2">
            {actionButtons}
          </div>
        </div>
      </div>
    )
  }

  if (sender_type === 'user') {
    return (
      <div className="group flex animate-message-in flex-row items-start justify-end gap-3 px-5 py-2">
        <div className="flex max-w-[72%] flex-col items-end">
          <div className={`rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${isDeleted ? 'bg-[var(--surface)] text-[var(--muted)]' : 'bg-[var(--user-bubble)] text-[var(--user-text)]'}`}>
            {isDeleted ? (
              <span className="italic">{DELETED_MESSAGE_CONTENT}</span>
            ) : (
              <FormattedMessageContent content={content} />
            )}
          </div>
          {children}
          <div className="mt-1.5 flex items-center justify-end gap-2 text-right">
            {actionButtons}
            <span className="text-xs text-gray-400">{formatTime(created_at)}</span>
          </div>
        </div>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white">
          {avatarInitial(currentUserName)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex animate-message-in justify-center px-5 py-3">
      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">{content}</span>
    </div>
  )
}
