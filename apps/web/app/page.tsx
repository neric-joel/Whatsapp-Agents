'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useRooms } from '@/hooks/useRooms'

export default function Page() {
  const { rooms, loading } = useRooms()
  const router = useRouter()

  useEffect(() => {
    if (!loading && rooms.length > 0) {
      router.replace(`/rooms/${rooms[0].id}`)
    }
  }, [rooms, loading, router])

  if (loading) return null

  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--surface)]">
      <p className="text-[var(--muted)] text-sm">No rooms yet</p>
    </div>
  )
}
