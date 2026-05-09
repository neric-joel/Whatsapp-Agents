'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRooms } from '@/hooks/useRooms'

export default function LeftSidebar() {
  const { rooms } = useRooms()
  const pathname = usePathname()

  return (
    <aside className="w-[260px] flex-shrink-0 h-full bg-[#18181b] flex flex-col">
      <div className="p-4 pb-2">
        <span className="text-[#f4f4f5] font-semibold text-base">AgentRoom 🤖</span>
      </div>
      <div className="px-4 py-2 text-[11px] font-medium tracking-widest text-[#52525b] uppercase">
        ROOMS
      </div>
      <nav className="flex-1 overflow-y-auto">
        {rooms.map((room) => {
          const isActive = pathname === `/rooms/${room.id}`
          return (
            <Link
              key={room.id}
              href={`/rooms/${room.id}`}
              className={`flex items-center px-3 py-2 rounded-md mx-2 text-sm transition-colors ${
                isActive
                  ? 'bg-[#27272a] border-l-2 border-[#8b5cf6] text-[#f4f4f5]'
                  : 'text-[#3f3f46] hover:bg-zinc-800/50'
              }`}
            >
              # {room.name}
            </Link>
          )
        })}
      </nav>
      <button className="px-4 py-3 text-sm text-[#52525b] hover:text-zinc-400 text-left transition-colors">
        + New Room
      </button>
    </aside>
  )
}
