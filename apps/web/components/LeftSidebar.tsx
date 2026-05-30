'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useRooms } from '@/hooks/useRooms'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function LeftSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [hasSession, setHasSession] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const { rooms, createRoom, creating, createError, deleteRoom, deletingRoomId, deleteError } = useRooms(
    pathname !== '/login' && hasSession,
  )

  useEffect(() => {
    if (pathname === '/login') {
      setCheckingSession(false)
      return
    }

    let mounted = true
    const supabase = createSupabaseBrowserClient()

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setHasSession(Boolean(data.session))
      setCheckingSession(false)
    })

    return () => {
      mounted = false
    }
  }, [pathname])

  if (pathname === '/login' || checkingSession || !hasSession) return null

  const handleCreateRoom = async () => {
    const room = await createRoom()
    if (!room) return

    router.push(`/rooms/${room.id}`)
    router.refresh()
  }

  const handleDeleteRoom = async (roomId: string) => {
    if (!window.confirm('Delete room?')) return

    const deleted = await deleteRoom(roomId)
    if (!deleted) return

    if (pathname === `/rooms/${roomId}`) {
      router.push('/')
    }
    router.refresh()
  }

  return (
    <aside className="w-[260px] flex-shrink-0 h-full bg-[#18181b] flex flex-col">
      <div className="p-4 pb-2">
        <span className="text-[#f4f4f5] font-semibold text-base">AgentRoom</span>
      </div>
      <div className="px-4 py-2 text-[11px] font-medium tracking-widest text-[#52525b] uppercase">
        ROOMS
      </div>
      <nav className="flex-1 overflow-y-auto">
        {rooms.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 p-6 text-center">
            <p className="text-[#52525b] text-sm mb-3">No rooms yet</p>
            <button
              type="button"
              onClick={handleCreateRoom}
              disabled={creating}
              className="text-[#8b5cf6] hover:text-violet-400 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? 'Creating...' : 'Create your first room'}
            </button>
            {createError && <p className="mt-3 text-xs text-red-300">{createError}</p>}
          </div>
        )}
        {rooms.map((room) => {
          const isActive = pathname === `/rooms/${room.id}`
          return (
            <div
              key={room.id}
              className={`group mx-2 flex items-center rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-[#27272a] border-l-2 border-[#8b5cf6] text-[#f4f4f5]'
                  : 'text-[#3f3f46] hover:bg-zinc-800/50'
              }`}
            >
              <Link
                href={`/rooms/${room.id}`}
                className="min-w-0 flex-1 truncate px-3 py-2"
              >
                # {room.name}
              </Link>
              <button
                type="button"
                aria-label={`Delete ${room.name}`}
                title="Delete room"
                disabled={deletingRoomId === room.id}
                onClick={() => { void handleDeleteRoom(room.id) }}
                className="mr-2 flex h-7 w-7 items-center justify-center rounded text-[#71717a] opacity-0 transition hover:bg-red-950/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40 group-hover:opacity-100"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v5" />
                  <path d="M14 11v5" />
                </svg>
              </button>
            </div>
          )
        })}
      </nav>
      {(createError || deleteError) && rooms.length > 0 && (
        <p className="px-4 pb-2 text-xs text-red-300">{createError ?? deleteError}</p>
      )}
      <button
        type="button"
        onClick={handleCreateRoom}
        disabled={creating}
        className="px-4 py-3 text-sm text-[#52525b] hover:text-zinc-400 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        {creating ? 'Creating...' : '+ New Room'}
      </button>
    </aside>
  )
}
