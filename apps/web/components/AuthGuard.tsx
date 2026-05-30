'use client'

import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'

import { useAuth } from '@/hooks/useAuth'
import { getAuthShellState } from '@/lib/auth-shell'

import LeftSidebar from './LeftSidebar'

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const shell = getAuthShellState({ pathname, loading, hasUser: Boolean(user) })

  useEffect(() => {
    if (shell.redirectTo) router.replace(shell.redirectTo)
  }, [router, shell.redirectTo])

  if (shell.render === 'none') return null

  if (shell.render === 'public') {
    return <div className="flex min-h-screen w-full flex-1">{children}</div>
  }

  return (
    <>
      <LeftSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </>
  )
}
