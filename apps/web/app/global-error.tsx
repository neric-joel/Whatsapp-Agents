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
      <body className="flex h-screen items-center justify-center bg-[#f5f7fb]">
        <div className="flex flex-col items-center gap-4 text-center p-8">
          <p className="text-sm text-slate-500">Something went wrong.</p>
          <button
            onClick={reset}
            className="rounded px-3 py-1.5 text-xs bg-[#2563eb] text-white hover:bg-[#1d4ed8] transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
