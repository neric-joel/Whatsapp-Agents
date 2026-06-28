'use client'
import Link from 'next/link'

import ProvidersPanel from '@/components/ProvidersPanel'

// The root layout's AppShell already provides the sidebar + app shell; this page
// renders only its content pane (a nested shell would double-render the sidebar).
export default function SettingsPage() {
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
        <h1 className="text-base font-semibold text-[var(--text)]">Settings</h1>
      </header>
      <main>
        <ProvidersPanel />
      </main>
    </div>
  )
}
