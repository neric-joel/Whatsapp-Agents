'use client'
import { useState } from 'react'

interface FileAttachment {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
}

interface Props {
  file: FileAttachment
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function mimeIcon(mime: string) {
  if (mime.startsWith('image/')) return '🖼️'
  if (mime === 'application/pdf') return '📄'
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('typescript')) return '🧾'
  return '📎'
}

async function fetchSignedUrl(fileId: string) {
  const res = await fetch(`/api/files/${fileId}/signed-download`)
  const json = await res.json() as { ok: boolean; data?: { signed_url: string } }
  if (!res.ok || !json.ok || !json.data) throw new Error('Failed to fetch signed URL')
  return json.data.signed_url
}

export default function FileAttachmentCard({ file }: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function openFile() {
    setLoading(true)
    try {
      const signedUrl = await fetchSignedUrl(file.id)
      if (file.mime_type.startsWith('image/')) setImgUrl(signedUrl)
      else window.open(signedUrl, '_blank', 'noopener,noreferrer')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-2 max-w-xs rounded-xl border border-[#27272a] bg-[#18181b] p-3 text-[#f4f4f5]">
      <div className="flex items-start gap-3">
        <span className="text-lg leading-5">{mimeIcon(file.mime_type)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.filename}</div>
          <div className="text-xs text-[#52525b]">{formatBytes(file.size_bytes)}</div>
        </div>
        <button
          type="button"
          onClick={() => void openFile()}
          disabled={loading}
          className="rounded-lg border border-[#27272a] px-2 py-1 text-xs text-[#f4f4f5] transition-colors hover:bg-[#27272a] disabled:opacity-50"
        >
          {file.mime_type.startsWith('image/') ? 'Preview' : 'Download'}
        </button>
      </div>
      {imgUrl && (
        <img
          src={imgUrl}
          alt={file.filename}
          className="mt-3 max-h-64 w-full rounded-lg object-contain"
        />
      )}
    </div>
  )
}
