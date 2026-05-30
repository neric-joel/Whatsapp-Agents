'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
      role="alert"
    >
      <h1 className="text-sm text-[var(--muted)]">Something went wrong.</h1>
      <button
        onClick={reset}
        className="rounded px-3 py-1.5 text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
