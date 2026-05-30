'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface FileRow {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  created_at: string
}

interface Props {
  roomId: string
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function FilesPanel({ roomId }: Props) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    setLoading(true)

    const supabase = createSupabaseBrowserClient()
    void supabase
      .from('files')
      .select('id, filename, mime_type, size_bytes, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!mounted) return
        setFiles((data as FileRow[] | null) ?? [])
        setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [roomId])

  return (
    <section className="border-b border-[#27272a]">
      <div className="border-b border-[#27272a] px-3 py-2 text-xs font-medium uppercase tracking-widest text-[#71717a]">
        Files
      </div>
      <div className="space-y-2 p-3">
        {loading ? (
          <p className="text-xs text-[#52525b]">Loading files...</p>
        ) : files.length === 0 ? (
          <p className="text-center text-xs text-[#52525b]">No files shared yet.</p>
        ) : (
          files.map((file) => (
            <div key={file.id} className="rounded-lg border border-[#27272a] bg-[#18181b] p-2">
              <p className="truncate text-sm font-medium text-[#f4f4f5]">{file.filename}</p>
              <p className="text-xs text-[#71717a]">{formatBytes(file.size_bytes)}</p>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
