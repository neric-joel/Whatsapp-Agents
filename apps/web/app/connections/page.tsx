'use client'
import Link from 'next/link'

import AuthGuard from '@/components/AuthGuard'
import ConnectionsPanel from '@/components/ConnectionsPanel'

export default function ConnectionsPage() {
  return (
    <AuthGuard>
      <div className="flex flex-1 flex-col overflow-y-auto bg-[var(--surface)]">
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Link
            href="/"
            aria-label="Back to rooms"
            className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            ← Back
          </Link>
          <h1 className="text-base font-semibold text-[var(--text)]">Connections</h1>
        </header>
        <main>
          <ConnectionsPanel />
        </main>
      </div>
    </AuthGuard>
  )
}
