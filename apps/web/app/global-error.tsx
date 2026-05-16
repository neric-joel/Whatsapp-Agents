'use client'

import { useEffect } from 'react'

export default function GlobalError({
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
    <html lang="en">
      <body className="flex h-screen items-center justify-center bg-[var(--app-bg)]">
        <div className="flex flex-col items-center gap-4 text-center p-8">
          <p className="text-sm text-[var(--muted)]">Something went wrong.</p>
          <button
            onClick={reset}
            className="rounded px-3 py-1.5 text-xs bg-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--accent-strong)] transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
