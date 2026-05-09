'use client'
import { useState, useEffect, useRef, useMemo, KeyboardEvent } from 'react'
import { useRooms } from '@/hooks/useRooms'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { OptimisticMessage } from './MessageTimeline'

interface Props {
  roomId: string
  onOptimistic: (msg: OptimisticMessage) => void
  onRefetch: () => void
}

interface SlimAgent {
  id: string
  slug: string
  name: string
}

const EVERYONE: SlimAgent = { id: '__everyone__', slug: 'everyone', name: 'Everyone' }

export default function ComposeBox({ roomId, onOptimistic, onRefetch }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(-1)
  const [roomAgents, setRoomAgents] = useState<SlimAgent[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLUListElement>(null)
  const { rooms } = useRooms()
  const room = rooms.find((r) => r.id === roomId)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase
      .from('room_members')
      .select('agent_id, agents!inner(id, slug, name, is_active)')
      .eq('room_id', roomId)
      .eq('member_type', 'agent')
      .eq('muted', false)
      .then(({ data }) => {
        if (!data) return
        const agents = (data as unknown as Array<{ agents: SlimAgent & { is_active: boolean } }>)
          .filter((m) => m.agents?.is_active)
          .map((m) => ({ id: m.agents.id, slug: m.agents.slug, name: m.agents.name }))
        setRoomAgents(agents)
      })
  }, [roomId])

  // Dismiss on click outside
  useEffect(() => {
    if (mentionQuery === null) return
    function onMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMentionQuery(null)
        setMentionStart(-1)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [mentionQuery])

  const mentionOptions = useMemo<SlimAgent[]>(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    const filtered = roomAgents.filter((a) => a.slug.toLowerCase().startsWith(q))
    return [
      ...('everyone'.startsWith(q) ? [EVERYONE] : []),
      ...filtered,
    ]
  }, [mentionQuery, roomAgents])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setText(val)
    const before = val.slice(0, cursor)
    const match = before.match(/@([\w-]*)$/)
    if (match) {
      setMentionQuery(match[1])
      setMentionStart(before.length - match[0].length)
    } else {
      setMentionQuery(null)
      setMentionStart(-1)
    }
  }

  function selectMention(slug: string) {
    const after = text.slice(mentionStart + 1 + (mentionQuery?.length ?? 0))
    const newText = text.slice(0, mentionStart) + '@' + slug + ' ' + after.trimStart()
    setText(newText)
    setMentionQuery(null)
    setMentionStart(-1)
    textareaRef.current?.focus()
  }

  async function submit() {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    setText('')
    setMentionQuery(null)
    setMentionStart(-1)
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
    if (mentionQuery !== null && e.key === 'Escape') {
      e.preventDefault()
      setMentionQuery(null)
      setMentionStart(-1)
      return
    }
    if (mentionQuery !== null && e.key === 'Enter') {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const showDropdown = mentionQuery !== null && mentionOptions.length > 0

  return (
    <div className="border-t border-[#27272a] bg-[#09090b] px-4 py-3 flex-shrink-0">
      <div className="relative flex items-end gap-3">
        {showDropdown && (
          <ul
            ref={dropdownRef}
            className="absolute bottom-full mb-1 left-0 right-[52px] bg-[#18181b] border border-[#27272a] rounded-xl overflow-hidden z-50 max-h-48 overflow-y-auto"
          >
            {mentionOptions.map((opt) => (
              <li
                key={opt.id}
                onMouseDown={(e) => { e.preventDefault(); selectMention(opt.slug) }}
                className="px-4 py-2 hover:bg-[#27272a] cursor-pointer flex items-center gap-2"
              >
                <span className="text-[#8b5cf6] text-sm font-medium">@{opt.slug}</span>
                <span className="text-[#52525b] text-xs">{opt.name}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
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
    </div>
  )
}
