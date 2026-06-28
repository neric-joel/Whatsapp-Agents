'use client'
import type { Room } from '@agentroom/shared'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FormEvent, MouseEvent, useMemo, useRef, useState } from 'react'

import { useRooms } from '@/hooks/useRooms'
import { useSessions } from '@/hooks/useSessions'
import { notifyChatCleared } from '@/lib/chat-events'

import SessionBar from './SessionBar'

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message?: string } | string }

function ArchiveIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path
        d="M4 6.5h12M5.5 6.5v8h9v-8M7 4h6l1 2.5H6L7 4Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 10h4" strokeLinecap="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path
        d="M4.5 6h11M8 6V4.5h4V6m-6 0 .5 9.5h7L14 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.5 9v4M11.5 9v4" strokeLinecap="round" />
    </svg>
  )
}

function ClearChatIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M4.5 5.5h11v7h-6l-3.5 3v-3H4.5v-7Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 8h6M7 10.5h3.5" strokeLinecap="round" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
      <circle cx="5" cy="10" r="1.4" />
      <circle cx="10" cy="10" r="1.4" />
      <circle cx="15" cy="10" r="1.4" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function getApiErrorMessage(response: ApiResponse<unknown>) {
  if (response.ok) return null
  return typeof response.error === 'string'
    ? response.error
    : (response.error.message ?? 'Request failed')
}

export default function LeftSidebar() {
  const { rooms, refreshRooms } = useRooms()
  const sessions = useSessions()
  const { active } = sessions
  const pathname = usePathname()
  const router = useRouter()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  // "Select your agents" catalog (connected CLIs only) — no agents are forced on a room.
  const [catalog, setCatalog] = useState<{ id: string; name: string; slug: string }[]>([])
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set())
  const [roomActionError, setRoomActionError] = useState<string | null>(null)
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [openRoomMenuId, setOpenRoomMenuId] = useState<string | null>(null)
  const dialogRef = useRef<HTMLFormElement>(null)
  // Element focused before the modal opened, so we can restore focus on close.
  const createTriggerRef = useRef<HTMLElement | null>(null)

  const { activeRooms, archivedRooms } = useMemo(
    () => ({
      activeRooms: rooms.filter((room) => !room.is_archived),
      archivedRooms: rooms.filter((room) => room.is_archived),
    }),
    [rooms],
  )

  function openCreateModal() {
    createTriggerRef.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null
    setRoomName('')
    setCreateError(null)
    setSelectedProfileIds(new Set())
    setIsCreateOpen(true)
    // Offer only connected CLIs as the room's agent catalog.
    void (async () => {
      try {
        const res = await fetch('/api/connections')
        const json = (await res.json()) as {
          ok: boolean
          data?: { profiles: { id: string; name: string; slug: string; enabled: boolean }[] }
        }
        if (res.ok && json.ok) {
          setCatalog(
            (json.data?.profiles ?? [])
              .filter((p) => p.enabled)
              .map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
          )
        }
      } catch {
        setCatalog([])
      }
    })()
  }

  function toggleProfile(id: string) {
    setSelectedProfileIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function closeCreateModal() {
    if (isCreating) return
    setIsCreateOpen(false)
    setRoomName('')
    setCreateError(null)
    // Return focus to whatever opened the dialog (WAI-ARIA dialog pattern).
    createTriggerRef.current?.focus?.()
  }

  // Focus trap: keep Tab / Shift+Tab cycling within the open dialog.
  function trapDialogFocus(e: React.KeyboardEvent) {
    if (e.key !== 'Tab' || !dialogRef.current) return
    const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    const enabled = Array.from(focusables).filter((el) => !el.hasAttribute('disabled'))
    if (enabled.length === 0) return
    const first = enabled[0]!
    const last = enabled[enabled.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = roomName.trim()
    if (!name) {
      setCreateError('Room name is required')
      return
    }

    setIsCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Attach the new room to the active session (Cowork working context), if any.
        body: JSON.stringify({ name, ...(active ? { session_id: active.id } : {}) }),
      })
      const payload = (await res.json().catch(() => null)) as ApiResponse<Room> | null
      if (!res.ok || !payload?.ok) {
        setCreateError(
          payload
            ? (getApiErrorMessage(payload) ?? 'Failed to create room')
            : 'Failed to create room',
        )
        return
      }

      // Attach the agents the user selected from the catalog (connected CLIs).
      const roomId = payload.data.id
      for (const pid of selectedProfileIds) {
        const p = catalog.find((x) => x.id === pid)
        if (!p) continue
        await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room_id: roomId,
            name: p.name,
            slug: p.slug,
            provider: 'custom',
            adapter_type: 'cli',
            cli_profile_id: p.id,
          }),
        }).catch(() => {
          /* a single agent failing to attach shouldn't block entering the room */
        })
      }

      setIsCreateOpen(false)
      setRoomName('')
      await refreshRooms()
      router.push(`/rooms/${roomId}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create room')
    } finally {
      setIsCreating(false)
    }
  }

  async function toggleArchive(room: Room, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setBusyRoomId(room.id)
    setRoomActionError(null)
    try {
      const res = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_archived: !room.is_archived }),
      })
      const payload = (await res.json().catch(() => null)) as ApiResponse<Room> | null
      if (!res.ok || !payload?.ok) {
        setRoomActionError(
          payload
            ? (getApiErrorMessage(payload) ?? 'Failed to update room')
            : 'Failed to update room',
        )
        return
      }
      await refreshRooms()
      setOpenRoomMenuId(null)
    } catch (err) {
      setRoomActionError(err instanceof Error ? err.message : 'Failed to update room')
    } finally {
      setBusyRoomId(null)
    }
  }

  async function renameRoom(room: Room, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    const next = window.prompt('Rename room', room.name)?.trim()
    setOpenRoomMenuId(null)
    if (!next || next === room.name) return
    setBusyRoomId(room.id)
    setRoomActionError(null)
    try {
      const res = await fetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next }),
      })
      const payload = (await res.json().catch(() => null)) as ApiResponse<Room> | null
      if (!res.ok || !payload?.ok) {
        setRoomActionError(
          payload
            ? (getApiErrorMessage(payload) ?? 'Failed to rename room')
            : 'Failed to rename room',
        )
        return
      }
      await refreshRooms()
    } catch (err) {
      setRoomActionError(err instanceof Error ? err.message : 'Failed to rename room')
    } finally {
      setBusyRoomId(null)
    }
  }

  async function deleteRoom(room: Room, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (!window.confirm(`Delete "${room.name}"? This cannot be undone.`)) return

    setBusyRoomId(room.id)
    setRoomActionError(null)
    try {
      const res = await fetch(`/api/rooms/${room.id}`, { method: 'DELETE' })
      const payload = (await res.json().catch(() => null)) as ApiResponse<{
        deleted: boolean
      }> | null
      if (!res.ok || !payload?.ok) {
        setRoomActionError(
          payload
            ? (getApiErrorMessage(payload) ?? 'Failed to delete room')
            : 'Failed to delete room',
        )
        return
      }
      await refreshRooms()
      setOpenRoomMenuId(null)
      if (pathname === `/rooms/${room.id}`) router.push('/')
    } catch (err) {
      setRoomActionError(err instanceof Error ? err.message : 'Failed to delete room')
    } finally {
      setBusyRoomId(null)
    }
  }

  async function clearRoomChat(room: Room, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (!window.confirm(`Clear chat in "${room.name}"? This cannot be undone.`)) return

    setBusyRoomId(room.id)
    setRoomActionError(null)
    try {
      const res = await fetch(`/api/rooms/${room.id}/messages`, { method: 'DELETE' })
      const payload = (await res.json().catch(() => null)) as ApiResponse<{
        cleared: boolean
      }> | null
      if (!res.ok || !payload?.ok) {
        setRoomActionError(
          payload
            ? (getApiErrorMessage(payload) ?? 'Failed to clear chat')
            : 'Failed to clear chat',
        )
        return
      }
      await refreshRooms()
      setOpenRoomMenuId(null)
      if (pathname === `/rooms/${room.id}`) {
        notifyChatCleared(room.id)
        router.refresh()
      }
    } catch (err) {
      setRoomActionError(err instanceof Error ? err.message : 'Failed to clear chat')
    } finally {
      setBusyRoomId(null)
    }
  }

  function renderRoom(room: Room) {
    const isActive = pathname === `/rooms/${room.id}`
    const isBusy = busyRoomId === room.id
    const isMenuOpen = openRoomMenuId === room.id

    return (
      <div key={room.id} className="group relative mx-2 flex items-center gap-1">
        <Link
          href={`/rooms/${room.id}`}
          className={`min-w-0 flex-1 truncate rounded-md px-3 py-2 text-sm transition-[background-color,color,transform] duration-150 hover:scale-[1.01] ${
            isActive
              ? 'bg-[var(--sidebar-active)] font-semibold text-[var(--text)]'
              : 'text-[var(--text)] hover:bg-[var(--sidebar-hover)]'
          }`}
        >
          # {room.name}
        </Link>
        <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setOpenRoomMenuId((current) => (current === room.id ? null : room.id))
            }}
            disabled={isBusy}
            title="Room actions"
            aria-label="Room actions"
            aria-expanded={isMenuOpen}
            className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--text)] disabled:opacity-40"
          >
            <MoreIcon />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-xl">
              <button
                type="button"
                onClick={(event) => renameRoom(room, event)}
                disabled={isBusy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40"
              >
                ✎ Rename
              </button>
              <button
                type="button"
                onClick={(event) => toggleArchive(room, event)}
                disabled={isBusy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40"
              >
                <ArchiveIcon />
                {room.is_archived ? 'Unarchive' : 'Archive'}
              </button>
              <button
                type="button"
                onClick={(event) => clearRoomChat(room, event)}
                disabled={isBusy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40"
              >
                <ClearChatIcon />
                Clear Chat
              </button>
              <button
                type="button"
                onClick={(event) => deleteRoom(room, event)}
                disabled={isBusy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
              >
                <TrashIcon />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <aside
      className="w-[260px] flex-shrink-0 h-full bg-[var(--sidebar)] flex flex-col border-r border-[var(--border)]"
      aria-label="Rooms"
    >
      <div className="flex items-center justify-between p-4 pb-2">
        <span className="text-base font-bold text-[var(--text)]">AgentRoom</span>
        <div className="flex items-center gap-1">
          <Link
            href="/connections"
            aria-label="Connections — connect your agent CLIs"
            title="Connections"
            className="rounded-md px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            🔌 Connect
          </Link>
          <Link
            href="/settings"
            aria-label="Settings — providers and API keys"
            title="Settings"
            className="rounded-md px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            ⚙ Settings
          </Link>
        </div>
      </div>
      <SessionBar
        sessions={sessions.sessions}
        active={active}
        loading={sessions.loading}
        onCreate={sessions.createSession}
        onRename={(id, name) => sessions.updateSession(id, { name })}
        onSwitch={(id) => sessions.updateSession(id, { touch: true })}
      />
      <div className="px-4 py-2 text-[11px] font-medium uppercase tracking-widest text-[var(--muted)]">
        ROOMS
      </div>
      <nav className="flex-1 overflow-y-auto" aria-label="Room list">
        {activeRooms.length === 0 && (
          <div
            className="flex flex-col items-center justify-center flex-1 p-6 text-center"
            role="status"
          >
            <p className="mb-3 text-sm text-[var(--muted)]">
              {rooms.length === 0 ? 'No rooms yet' : 'No active rooms'}
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="text-sm font-medium text-[var(--text)] transition-colors hover:text-[var(--accent-strong)]"
            >
              Create your first room
            </button>
          </div>
        )}
        <div className="space-y-1">{activeRooms.map(renderRoom)}</div>
        {roomActionError && (
          <p
            role="alert"
            className="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            {roomActionError}
          </p>
        )}
        {archivedRooms.length > 0 && (
          <div className="mt-4 border-t border-white/10 pt-2">
            <button
              type="button"
              onClick={() => setShowArchived((value) => !value)}
              className="flex w-full items-center gap-1 px-4 py-2 text-left text-[11px] font-medium uppercase tracking-widest text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              aria-expanded={showArchived}
            >
              <ChevronIcon open={showArchived} />
              Archived
            </button>
            {showArchived && <div className="space-y-1">{archivedRooms.map(renderRoom)}</div>}
          </div>
        )}
      </nav>
      <div className="border-t border-[var(--border)]">
        <button
          type="button"
          onClick={openCreateModal}
          className="w-full px-4 py-3 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--text)]"
        >
          + New Room
        </button>
      </div>

      {isCreateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4"
          onMouseDown={(event) => {
            // Click on the backdrop (not the dialog) dismisses.
            if (event.target === event.currentTarget) closeCreateModal()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeCreateModal()
            else trapDialogFocus(event)
          }}
        >
          <form
            ref={dialogRef}
            onSubmit={handleCreateRoom}
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-room-title"
          >
            <h2 id="create-room-title" className="text-lg font-semibold text-zinc-950">
              New room
            </h2>
            <label className="mt-4 block text-sm font-medium text-zinc-700" htmlFor="room-name">
              Room name
            </label>
            <input
              id="room-name"
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              autoFocus
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
              placeholder="Planning"
              disabled={isCreating}
            />
            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-zinc-700">
                Agents <span className="font-normal text-zinc-500">— pick who joins this room</span>
              </legend>
              {catalog.length === 0 ? (
                <p className="mt-1 text-xs text-zinc-500">
                  No CLIs connected yet.{' '}
                  <Link href="/connections" className="text-violet-600 underline">
                    Connect one
                  </Link>{' '}
                  to add agents (you can also add them after creating the room).
                </p>
              ) : (
                <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-zinc-200 p-2">
                  {catalog.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-zinc-800 hover:bg-zinc-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedProfileIds.has(p.id)}
                        onChange={() => toggleProfile(p.id)}
                        disabled={isCreating}
                      />
                      {p.name} <span className="text-xs text-zinc-500">@{p.slug}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            {createError && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {createError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={isCreating}
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreating}
                className="rounded-md bg-[#8b5cf6] px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-600 disabled:opacity-50"
              >
                {isCreating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  )
}
