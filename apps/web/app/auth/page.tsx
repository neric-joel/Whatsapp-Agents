'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Mode = 'signin' | 'signup'

export default function AuthPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createSupabaseBrowserClient()

    try {
      if (mode === 'signup') {
        const { error: err } = await supabase.auth.signUp({ email, password })
        if (err) { setError(err.message); return }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) { setError(err.message); return }
      }
      router.push('/')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#09090b] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-[#f4f4f5]">AgentRoom</h1>
          <p className="mt-1 text-sm text-[#71717a]">AI-powered group chat</p>
        </div>

        <div className="overflow-hidden rounded-xl border border-[#27272a] bg-[#18181b]">
          <div className="flex border-b border-[#27272a]">
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(null) }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mode === 'signin'
                  ? 'bg-[#27272a] text-[#f4f4f5]'
                  : 'text-[#71717a] hover:text-[#a1a1aa]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(null) }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mode === 'signup'
                  ? 'bg-[#27272a] text-[#f4f4f5]'
                  : 'text-[#71717a] hover:text-[#a1a1aa]'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-[#a1a1aa] mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                disabled={loading}
                className="w-full rounded-md border border-[#3f3f46] bg-[#09090b] px-3 py-2 text-sm text-[#f4f4f5] placeholder-[#52525b] outline-none transition focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#8b5cf6]/20 disabled:opacity-50"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-[#a1a1aa] mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="••••••••"
                disabled={loading}
                className="w-full rounded-md border border-[#3f3f46] bg-[#09090b] px-3 py-2 text-sm text-[#f4f4f5] placeholder-[#52525b] outline-none transition focus:border-[#8b5cf6] focus:ring-2 focus:ring-[#8b5cf6]/20 disabled:opacity-50"
              />
            </div>

            {error && (
              <p className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-[#8b5cf6] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
            >
              {loading ? (mode === 'signup' ? 'Creating account…' : 'Signing in…') : (mode === 'signup' ? 'Create account' : 'Sign in')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
