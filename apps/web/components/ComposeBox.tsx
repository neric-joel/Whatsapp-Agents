'use client'
import { useState, useEffect, useRef, useMemo, KeyboardEvent, ChangeEvent } from 'react'
import { useRooms } from '@/hooks/useRooms'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { OptimisticMessage } from './MessageTimeline'

interface Props {
  roomId: string
  onOptimistic: (msg: OptimisticMessage) => void
  onRefetch: () => void
  replyingTo?: {
    id: string
    content: string
    sender_type: string
    agents?: { name: string; provider: string } | null
  } | null
  onCancelReply?: () => void
}

interface SlimAgent {
  id: string
  slug: string
  name: string
}

const EVERYONE: SlimAgent = { id: '__everyone__', slug: 'everyone', name: 'Everyone' }

export default function ComposeBox({ roomId, onOptimistic, onRefetch, replyingTo, onCancelReply }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [attachedFile, setAttachedFile] = useState<{ id: string; name: string } | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(-1)
  const [roomAgents, setRoomAgents] = useState<SlimAgent[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  async function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setFileError(null)
    try {
      const res = await fetch(`/api/rooms/${roomId}/files/signed-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
        }),
      })
      const json = await res.json().catch(() => ({})) as {
        ok?: boolean
        data?: { signed_url: string; file_id: string }
        error?: { message?: string }
      }
      if (!res.ok || !json.ok || !json.data) {
        setFileError(json.error?.message ?? 'Upload failed')
        return
      }

      const uploadRes = await fetch(json.data.signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!uploadRes.ok) {
        setFileError('Upload failed')
        return
      }

      setAttachedFile({ id: json.data.file_id, name: file.name })
    } catch {
      setFileError('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    const content = text.trim() || attachedFile?.name
    if (!content || sending || uploading) return
    setSending(true)
    const metadata = attachedFile ? { file_ids: [attachedFile.id] } : {}
    try {
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, metadata, reply_to_id: replyingTo?.id }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: { message?: string } }
        setSendError(json.error?.message ?? 'Failed to send message')
        return
      }
      setSendError(null)
      setText('')
      setMentionQuery(null)
      setMentionStart(-1)
      onOptimistic({
        id: crypto.randomUUID(),
        content,
        sender_type: 'user',
        created_at: new Date().toISOString(),
        metadata,
        reply_to_id: replyingTo?.id ?? null,
      })
      setAttachedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      onCancelReply?.()
      onRefetch()
    } finally {
      setSending(false)
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
  const replySender = replyingTo?.sender_type === 'agent'
    ? replyingTo.agents?.name ?? 'Agent'
    : replyingTo?.sender_type === 'user'
      ? 'You'
      : 'System'
  const replyPreview = replyingTo
    ? replyingTo.content.length > 80
      ? `${replyingTo.content.slice(0, 80)}...`
      : replyingTo.content
    : ''

  return (
    <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-3">
      {replyingTo && (
        <div className="mb-3 flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="min-w-0 flex-1 border-l-2 border-purple-700 pl-3">
            <div className="text-xs font-semibold text-purple-700">{replySender}</div>
            <div className="truncate text-xs text-gray-500">{replyPreview}</div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="rounded-md px-2 py-1 text-sm text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cancel reply"
          >
            x
          </button>
        </div>
      )}
      <div className="relative flex items-end gap-3">
        {showDropdown && (
          <ul
            ref={dropdownRef}
            className="absolute bottom-full left-0 right-[52px] z-50 mb-2 max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg"
          >
            {mentionOptions.map((opt) => (
              <li
                key={opt.id}
                onMouseDown={(e) => { e.preventDefault(); selectMention(opt.slug) }}
                className="flex cursor-pointer items-center gap-2 px-4 py-2 hover:bg-gray-50"
              >
                <span className="text-sm font-medium text-purple-700">@{opt.slug}</span>
                <span className="text-xs text-gray-500">{opt.name}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={`Message #${room?.name ?? '...'}...`}
          rows={1}
          className="max-h-32 min-h-[46px] flex-1 resize-none overflow-y-auto rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-shadow placeholder:text-gray-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-100"
        />
        {sendError && (
          <p className="absolute left-1 top-full mt-1 px-1 text-xs text-red-600">{sendError}</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          className="hidden"
          onChange={handleFileSelect}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending}
          className="rounded-lg px-2 py-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
          aria-label="Attach file"
        >
          +
        </button>
        {attachedFile && (
          <span className="flex max-w-[12rem] items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700">
            <span className="truncate">{attachedFile.name}</span>
            <button
              type="button"
              onClick={() => {
                setAttachedFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="text-gray-400 hover:text-gray-700"
              aria-label="Clear attached file"
            >
              x
            </button>
          </span>
        )}
        {fileError && !attachedFile && (
          <span className="flex max-w-[12rem] items-center gap-2 rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-xs text-red-600">
            <span className="truncate">{fileError}</span>
            <button
              type="button"
              onClick={() => setFileError(null)}
              className="text-red-400 hover:text-red-600"
              aria-label="Dismiss upload error"
            >
              x
            </button>
          </span>
        )}
        <button
          onClick={() => void submit()}
          disabled={(!text.trim() && !attachedFile) || sending || uploading}
          className="flex-shrink-0 rounded-lg bg-purple-700 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-purple-800 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  )
}
