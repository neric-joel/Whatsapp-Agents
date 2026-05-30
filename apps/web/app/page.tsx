'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRooms } from '@/hooks/useRooms'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function Page() {
  const router = useRouter()
  const [hasSession, setHasSession] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const { rooms, loading, error } = useRooms(hasSession)

  useEffect(() => {
    let mounted = true
    const supabase = createSupabaseBrowserClient()

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return

      if (!data.session) {
        router.replace('/login')
        return
      }

      setHasSession(true)
      setCheckingSession(false)
    })

    return () => {
      mounted = false
    }
  }, [router])

  useEffect(() => {
    if (hasSession && !loading && rooms.length > 0) {
      router.replace(`/rooms/${rooms[0].id}`)
    }
  }, [hasSession, rooms, loading, router])

  if (checkingSession || loading) return null

  return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-[#52525b] text-sm">{error ?? 'No rooms yet'}</p>
    </div>
  )
}
