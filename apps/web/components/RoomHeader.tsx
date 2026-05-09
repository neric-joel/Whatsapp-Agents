'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface Props {
  roomId: string
}

export default function RoomHeader({ roomId }: Props) {
  const [roomName, setRoomName] = useState<string | null>(null)
  const [agentCount, setAgentCount] = useState(0)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    Promise.all([
      supabase.from('rooms').select('name').eq('id', roomId).single(),
      supabase
        .from('room_members')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', roomId)
        .eq('member_type', 'agent'),
    ]).then(([roomRes, membersRes]) => {
      if (roomRes.data) setRoomName((roomRes.data as { name: string }).name)
      if (membersRes.count != null) setAgentCount(membersRes.count)
    })
  }, [roomId])

  return (
    <header className="h-12 flex items-center px-4 border-b border-[#27272a] flex-shrink-0">
      <span className="text-[#f4f4f5] font-semibold text-[15px] flex-1">
        # {roomName ?? '…'}
      </span>
      <span className="text-[#52525b] text-sm">{agentCount} agents</span>
    </header>
  )
}
