'use client'
import { useCallback, useEffect, useState } from 'react'

interface FileRow {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  created_at: string
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Cowork-style "Outputs" surface — the files produced/attached in this room (stored
 * locally under the app-data files/ folder). Polls so new artifacts appear without a
 * refresh.
 */
export default function OutputsPanel({ roomId }: { roomId: string }) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/files`)
      const json = (await res.json()) as { ok: boolean; data?: FileRow[] }
      if (res.ok && json.ok) setFiles(json.data ?? [])
    } catch {
      /* keep last-known list */
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    // Reset on room switch so the previous room's outputs don't flash before the refetch.
    setFiles([])
    setLoading(true)
    void load()
    const t = setInterval(() => void load(), 4000)
    return () => clearInterval(t)
  }, [load])

  if (loading) {
    return (
      <p role="status" className="px-4 py-3 text-xs text-[var(--muted)]">
        Loading outputs…
      </p>
    )
  }
  if (files.length === 0) {
    return (
      <p role="status" className="px-4 py-3 text-xs text-[var(--muted)]">
        No outputs yet. Files attached or produced in this room appear here.
      </p>
    )
  }
  return (
    <ul className="space-y-1 px-3 py-2">
      {files.map((f) => (
        <li key={f.id}>
          <a
            href={`/api/files/${f.id}/signed-download`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)] transition-colors hover:border-[var(--accent)]"
            title={f.filename}
          >
            <span className="truncate">{f.filename}</span>
            <span className="shrink-0 text-[10px] text-[var(--muted)]">
              {formatBytes(f.size_bytes)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
