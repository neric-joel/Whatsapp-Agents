import { type ReactNode } from 'react'

import LeftSidebar from './LeftSidebar'

/**
 * The app shell: a persistent left sidebar + the routed content pane. AgentRoom is a
 * local single-user app with no login, so there is no auth gate — every route renders
 * the shell. Nested pages render only their own content pane (the root layout mounts this).
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <LeftSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </>
  )
}
