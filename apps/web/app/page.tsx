import { getDb } from '@agentroom/db'
import { redirect } from 'next/navigation'

/**
 * `/` is a landing route: it sends you to the most recently active room, or shows the empty
 * state when there are none.
 *
 * This redirect is deliberately SERVER-side. It used to be a client effect
 * (`useRooms()` + `router.replace`) with `rooms` in its dependency array, which made it a
 * standing rule that re-fired on every room-list change — including the `refreshRooms()`
 * that room creation performs. It could then land *after* creation's own `router.push` and
 * silently drop the user in `rooms[0]` instead of the room they just made — the ordering below
 * puts rooms with messages ahead of message-less ones, so a brand-new room only sorts first
 * when no room has messages at all (a fresh install, which is why an empty database hid this). Two components asserting
 * control over the route with no coordination is a race that cannot be closed by ordering
 * them; removing one of the two contenders closes it. By the time any client code runs, the
 * redirect has already happened, so there is nothing left to race.
 *
 * Ordering MUST match `GET /api/rooms`, which is what fills the sidebar — otherwise `/`
 * lands somewhere other than the room shown first.
 */

// Reads SQLite per request, so this route must never be prerendered: without this, `next
// build` would open the database at build time and bake its contents into the output.
export const dynamic = 'force-dynamic'

export default function Page() {
  const first = getDb()
    .prepare(
      `SELECT id FROM rooms
       WHERE is_archived = 0
       ORDER BY (last_message_at IS NULL), last_message_at DESC, created_at DESC
       LIMIT 1`,
    )
    .get() as { id: string } | undefined

  // Outside any try/catch on purpose — redirect() signals by throwing.
  if (first) redirect(`/rooms/${first.id}`)

  return (
    <div className="flex flex-1 items-center justify-center bg-[var(--surface)]">
      <p className="text-sm text-[var(--muted)]">No rooms yet</p>
    </div>
  )
}
