'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Local single-user app — there is no login. This route only exists so any old
 * bookmark to /auth lands back in the app instead of 404ing.
 */
export default function AuthRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/')
  }, [router])
  return null
}
