'use client'
import { useState, KeyboardEvent } from 'react'
import { useRooms } from '@/hooks/useRooms'
import type { OptimisticMessage } from './MessageTimeline'

interface Props {
  roomId: string
  onOptimistic: (msg: OptimisticMessage) => void
  onRefetch: () => void
}

export default function ComposeBox({ roomId, onOptimistic, onRefetch }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const { rooms } = useRooms()
  const room = rooms.find((r) => r.id === roomId)

  async function submit() {
    const content = text.trim()
    if (!content || sending) return

    setSending(true)
    setText('')

    onOptimistic({
      id: crypto.randomUUID(),
      content,
      sender_type: 'user',
      created_at: new Date().toISOString(),
    })

    try {
      await fetch(`/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
    } finally {
      setSending(false)
      onRefetch()
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="border-t border-[#27272a] bg-[#09090b] px-4 py-3 flex items-end gap-3 flex-shrink-0">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={`Message #${room?.name ?? '…'}...`}
        rows={1}
        className="bg-[#18181b] text-[#f4f4f5] text-[14px] placeholder:text-[#3f3f46] rounded-xl px-4 py-2.5 flex-1 resize-none outline-none min-h-[40px] max-h-32 overflow-y-auto"
      />
      <button
        onClick={() => void submit()}
        disabled={!text.trim() || sending}
        className="bg-[#8b5cf6] hover:bg-violet-400 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 transition-colors flex-shrink-0"
      >
        Send
      </button>
    </div>
  )
}
