'use client'

import { useCallback, useEffect, useState } from 'react'
import RoomAgentsPanel from './RoomAgentsPanel'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface Props {
  roomId: string
}

export default function RoomHeader({ roomId }: Props) {
  const [roomName, setRoomName] = useState<string | null>(null)
  const [replyMode, setReplyMode] = useState<string | null>(null)
  const [agentCount, setAgentCount] = useState(0)
  const [managingAgents, setManagingAgents] = useState(false)

  const fetchRoomSummary = useCallback(() => {
    const supabase = createSupabaseBrowserClient()
    void Promise.all([
      supabase.from('rooms').select('name, reply_mode').eq('id', roomId).single(),
      supabase
        .from('room_members')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', roomId)
        .eq('member_type', 'agent'),
    ]).then(([roomRes, membersRes]) => {
      if (roomRes.data) {
        const room = roomRes.data as { name: string; reply_mode?: string | null }
        setRoomName(room.name)
        setReplyMode(room.reply_mode ?? null)
      }
      if (membersRes.count != null) setAgentCount(membersRes.count)
    })
  }, [roomId])

  useEffect(() => {
    fetchRoomSummary()
  }, [fetchRoomSummary])

  return (
    <>
      <header className="h-12 flex items-center gap-3 px-4 border-b border-[#27272a] flex-shrink-0">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[#f4f4f5] font-semibold text-[15px]">
            # {roomName ?? '...'}
          </span>
          <span
            className={
              replyMode === 'mentioned_only'
                ? 'flex-shrink-0 rounded-full border border-[#8b5cf6]/30 bg-[#8b5cf6]/10 px-2 py-0.5 text-[11px] font-medium text-[#8b5cf6]'
                : 'flex-shrink-0 rounded-full border border-[#27272a] bg-[#18181b] px-2 py-0.5 text-[11px] font-medium text-[#71717a]'
            }
          >
            {replyMode === 'mentioned_only' ? '@ only' : 'broadcast'}
          </span>
        </div>
        <span className="text-[#52525b] text-sm">{agentCount} agents</span>
        <button
          type="button"
          onClick={() => { setManagingAgents(true) }}
          className="rounded border border-[#3f3f46] px-3 py-1.5 text-xs font-medium text-[#d4d4d8] transition hover:border-[#8b5cf6] hover:bg-[#27272a] hover:text-[#f4f4f5]"
        >
          Manage Agents
        </button>
      </header>
      <RoomAgentsPanel
        roomId={roomId}
        open={managingAgents}
        onClose={() => { setManagingAgents(false) }}
        onChanged={fetchRoomSummary}
      />
    </>
  )
}
