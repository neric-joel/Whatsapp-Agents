'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useRooms } from '@/hooks/useRooms'

export default function Page() {
  const { rooms, loading } = useRooms()
  const router = useRouter()

  useEffect(() => {
    const first = rooms[0]
    if (!loading && first) {
      router.replace(`/rooms/${first.id}`)
    }
  }, [rooms, loading, router])

  if (loading) return null

  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--surface)]">
      <p className="text-[var(--muted)] text-sm">No rooms yet</p>
    </div>
  )
}
