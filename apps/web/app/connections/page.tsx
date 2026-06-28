'use client'
import Link from 'next/link'

import ConnectionsPanel from '@/components/ConnectionsPanel'

// The root layout's AppShell already provides the sidebar + app shell, so this page
// renders ONLY its content pane (a nested shell would double-render the sidebar and
// push this panel off-screen — the historical "broken Connect button").
export default function ConnectionsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--surface)]">
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
  )
}
