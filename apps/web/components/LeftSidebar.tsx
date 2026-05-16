'use client'
import { FormEvent, MouseEvent, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useRooms } from '@/hooks/useRooms'
import type { Room } from '@agentroom/shared'

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message?: string } | string }

function ArchiveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 6.5h12M5.5 6.5v8h9v-8M7 4h6l1 2.5H6L7 4Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10h4" strokeLinecap="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4.5 6h11M8 6V4.5h4V6m-6 0 .5 9.5h7L14 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 9v4M11.5 9v4" strokeLinecap="round" />
    </svg>
  )
}

function ClearChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
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
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function getApiErrorMessage(response: ApiResponse<unknown>) {
  if (response.ok) return null
  return typeof response.error === 'string' ? response.error : response.error.message ?? 'Request failed'
}

export default function LeftSidebar() {
  const { rooms, refreshRooms } = useRooms()
  const pathname = usePathname()
  const router = useRouter()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [roomActionError, setRoomActionError] = useState<string | null>(null)
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [openRoomMenuId, setOpenRoomMenuId] = useState<string | null>(null)

  const { activeRooms, archivedRooms } = useMemo(() => ({
    activeRooms: rooms.filter((room) => !room.is_archived),
    archivedRooms: rooms.filter((room) => room.is_archived),
  }), [rooms])

  function openCreateModal() {
    setRoomName('')
    setCreateError(null)
    setIsCreateOpen(true)
  }

  function closeCreateModal() {
    if (isCreating) return
    setIsCreateOpen(false)
    setRoomName('')
    setCreateError(null)
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
        body: JSON.stringify({ name }),
      })
      const payload = await res.json().catch(() => null) as ApiResponse<Room> | null
      if (!res.ok || !payload?.ok) {
        setCreateError(payload ? getApiErrorMessage(payload) ?? 'Failed to create room' : 'Failed to create room')
        return
      }

      setIsCreateOpen(false)
      setRoomName('')
      await refreshRooms()
      router.push(`/rooms/${payload.data.id}`)
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
      const payload = await res.json().catch(() => null) as ApiResponse<Room> | null
      if (!res.ok || !payload?.ok) {
        setRoomActionError(payload ? getApiErrorMessage(payload) ?? 'Failed to update room' : 'Failed to update room')
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

  async function deleteRoom(room: Room, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (!window.confirm(`Delete "${room.name}"? This cannot be undone.`)) return

    setBusyRoomId(room.id)
    setRoomActionError(null)
    try {
      const res = await fetch(`/api/rooms/${room.id}`, { method: 'DELETE' })
      const payload = await res.json().catch(() => null) as ApiResponse<{ deleted: boolean }> | null
      if (!res.ok || !payload?.ok) {
        setRoomActionError(payload ? getApiErrorMessage(payload) ?? 'Failed to delete room' : 'Failed to delete room')
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
      const payload = await res.json().catch(() => null) as ApiResponse<{ cleared: boolean }> | null
      if (!res.ok || !payload?.ok) {
        setRoomActionError(payload ? getApiErrorMessage(payload) ?? 'Failed to clear chat' : 'Failed to clear chat')
        return
      }
      await refreshRooms()
      setOpenRoomMenuId(null)
      if (pathname === `/rooms/${room.id}`) router.refresh()
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
              ? 'bg-white/20 font-semibold text-white'
              : 'text-white/90 hover:bg-white/10 hover:text-white'
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
              setOpenRoomMenuId((current) => current === room.id ? null : room.id)
            }}
            disabled={isBusy}
            title="Room actions"
            aria-label="Room actions"
            aria-expanded={isMenuOpen}
            className="rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <MoreIcon />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-9 z-20 w-40 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-xl">
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
    <aside className="w-[260px] flex-shrink-0 h-full bg-gradient-to-b from-[#18181b] to-[#111113] flex flex-col">
      <div className="p-4 pb-2">
        <span className="text-base font-bold text-white">AgentRoom</span>
      </div>
      <div className="px-4 py-2 text-[11px] font-medium uppercase tracking-widest text-white/60">
        ROOMS
      </div>
      <nav className="flex-1 overflow-y-auto">
        {activeRooms.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 p-6 text-center">
            <p className="mb-3 text-sm text-white/60">
              {rooms.length === 0 ? 'No rooms yet' : 'No active rooms'}
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="text-sm font-medium text-white/90 transition-colors hover:text-white"
            >
              Create your first room
            </button>
          </div>
        )}
        <div className="space-y-1">
          {activeRooms.map(renderRoom)}
        </div>
        {roomActionError && (
          <p className="mx-4 mt-3 rounded border border-white/10 bg-white/10 px-3 py-2 text-xs text-red-100">
            {roomActionError}
          </p>
        )}
        {archivedRooms.length > 0 && (
          <div className="mt-4 border-t border-white/10 pt-2">
            <button
              type="button"
              onClick={() => setShowArchived((value) => !value)}
              className="flex w-full items-center gap-1 px-4 py-2 text-left text-[11px] font-medium uppercase tracking-widest text-white/60 transition-colors hover:text-white"
              aria-expanded={showArchived}
            >
              <ChevronIcon open={showArchived} />
              Archived
            </button>
            {showArchived && (
              <div className="space-y-1">
                {archivedRooms.map(renderRoom)}
              </div>
            )}
          </div>
        )}
      </nav>
      <button
        type="button"
        onClick={openCreateModal}
        className="px-4 py-3 text-left text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        + New Room
      </button>

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <form onSubmit={handleCreateRoom} className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-zinc-950">New room</h2>
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
            {createError && <p className="mt-3 text-sm text-red-600">{createError}</p>}
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
