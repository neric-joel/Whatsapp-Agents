'use client'

import { createBrowserClient } from '@supabase/ssr'
import { type FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      ),
    [],
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'signin' | 'signup' | null>(null)

  const finishAuth = () => {
    router.replace('/')
    router.refresh()
  }

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setPendingAction('signin')

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setPendingAction(null)
    if (signInError) {
      setError(signInError.message)
      return
    }

    finishAuth()
  }

  const handleSignUp = async () => {
    setError(null)
    setPendingAction('signup')

    const { error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError) {
      setPendingAction(null)
      setError(signUpError.message)
      return
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setPendingAction(null)
    if (signInError) {
      setError(signInError.message)
      return
    }

    finishAuth()
  }

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-zinc-900 px-4 text-zinc-100">
      <form
        onSubmit={handleSignIn}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-6 shadow-xl"
      >
        <div>
          <h1 className="text-xl font-semibold text-zinc-50">Sign in to AgentRoom</h1>
          <p className="mt-1 text-sm text-zinc-500">Use your Supabase account to continue.</p>
        </div>

        <label className="flex flex-col gap-2 text-sm text-zinc-300">
          Email
          <input
            type="email"
            value={email}
            placeholder="you@example.com"
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-500"
            required
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-zinc-300">
          Password
          <input
            type="password"
            value={password}
            placeholder="••••••••"
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-500"
            required
          />
        </label>

        {error && (
          <div className="rounded-md border border-red-900/70 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={pendingAction !== null}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pendingAction === 'signin' ? 'Signing in...' : 'Sign in'}
        </button>

        <p className="text-center text-sm text-zinc-500">
          No account?{' '}
          <button
            type="button"
            onClick={handleSignUp}
            disabled={pendingAction !== null}
            className="font-medium text-violet-400 transition-colors hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingAction === 'signup' ? 'Creating account...' : 'Sign up'}
          </button>
        </p>
      </form>
    </main>
  )
}
