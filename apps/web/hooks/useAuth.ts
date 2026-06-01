'use client'

import type { User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export function useAuth() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/auth')
  }, [router])

  return { user, loading, signOut }
}
