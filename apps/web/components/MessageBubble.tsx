'use client'

import type { ReactNode } from 'react'

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

export interface MessageBubbleProps {
  message: {
    id: string
    content: string
    sender_type: string
    created_at: string
    agents?: { name: string; provider: string } | null
  }
  children?: ReactNode
  onPin?: (messageId: string, content: string) => void
}

export default function MessageBubble({ message, children, onPin }: MessageBubbleProps) {
  const { content, sender_type, created_at, agents } = message

  if (sender_type === 'agent') {
    return (
      <div className="flex flex-row items-start gap-2 px-4 py-1">
        <div className="w-7 h-7 rounded-full bg-[#27272a] flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] text-[#52525b]">
            {agents ? initials(agents.name) : 'AG'}
          </span>
        </div>
        <div className="flex flex-col max-w-[70%]">
          <span className="text-[11px] text-[#52525b] mb-0.5">
            {agents?.name ?? 'Agent'}
          </span>
          <div className="bg-[#27272a] text-[#f4f4f5] text-[14px] px-3 py-2 rounded-2xl rounded-tl-none">
            {content}
          </div>
          {children}
          <div className="mt-0.5 ml-1 flex items-center gap-2">
            <span className="text-[11px] text-[#52525b]">{formatTime(created_at)}</span>
            {onPin && (
              <button
                type="button"
                onClick={() => onPin(message.id, content)}
                className="text-[11px] text-[#52525b] transition-colors hover:text-[#f4f4f5]"
              >
                Pin
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (sender_type === 'user') {
    return (
      <div className="flex flex-row justify-end px-4 py-1">
        <div className="flex flex-col items-end max-w-[70%]">
          <div className="bg-[#8b5cf6] text-white text-[14px] px-3 py-2 rounded-2xl rounded-tr-none">
            {content}
          </div>
          {children}
          <div className="mt-0.5 flex items-center justify-end gap-2 text-right">
            {onPin && (
              <button
                type="button"
                onClick={() => onPin(message.id, content)}
                className="text-[11px] text-[#52525b] transition-colors hover:text-[#f4f4f5]"
              >
                Pin
              </button>
            )}
            <span className="text-[11px] text-[#52525b]">{formatTime(created_at)}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-center px-4 py-2">
      <span className="text-[11px] text-[#52525b]">{content}</span>
    </div>
  )
}
