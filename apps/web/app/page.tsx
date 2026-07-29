'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { useRooms } from '@/hooks/useRooms'

export default function Page() {
  const { rooms, loading } = useRooms()
  const router = useRouter()
  const pathname = usePathname()

  // `rooms` is a dependency, so this re-runs on every room-list change — including the
  // refreshRooms() that room creation performs. Without the pathname guard it would then
  // redirect to rooms[0] and clobber the navigation the creator just started: /api/rooms
  // orders rooms with messages first, so a brand-new (message-less) room is never rooms[0]
  // and the user lands in a different room than the one they created. Only redirect while
  // `/` is still genuinely the current route; once a navigation has committed, stand down.
  useEffect(() => {
    if (loading || pathname !== '/') return
    const first = rooms[0]
    if (first) router.replace(`/rooms/${first.id}`)
  }, [rooms, loading, pathname, router])

  if (loading) return null

  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--surface)]">
      <p className="text-[var(--muted)] text-sm">No rooms yet</p>
    </div>
  )
}
