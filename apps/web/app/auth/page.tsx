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
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-[#dbeafe] via-[#ecfeff] to-[#ede9fe] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-[#0f172a]">AgentRoom</h1>
          <p className="mt-1 text-sm text-[#475569]">AI-powered group chat</p>
        </div>

        <div className="overflow-hidden rounded-xl border border-sky-100 bg-white shadow-xl">
          <div className="flex border-b border-sky-100 bg-[#f8fbff]">
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(null) }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mode === 'signin'
                  ? 'bg-[#2563eb] text-white'
                  : 'text-[#475569] hover:text-[#0f172a]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); setError(null) }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mode === 'signup'
                  ? 'bg-[#2563eb] text-white'
                  : 'text-[#475569] hover:text-[#0f172a]'
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-[#475569] mb-1.5">
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
                className="w-full rounded-md border border-sky-200 bg-white px-3 py-2 text-sm text-[#0f172a] placeholder-[#94a3b8] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20 disabled:opacity-50"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-[#475569] mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="Password"
                disabled={loading}
                className="w-full rounded-md border border-sky-200 bg-white px-3 py-2 text-sm text-[#0f172a] placeholder-[#94a3b8] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20 disabled:opacity-50"
              />
            </div>

            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-[#2563eb] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-50"
            >
              {loading ? (mode === 'signup' ? 'Creating account...' : 'Signing in...') : (mode === 'signup' ? 'Create account' : 'Sign in')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
