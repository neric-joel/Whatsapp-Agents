'use client'

import { useEffect, useRef, useState } from 'react'

import { useToast } from '@/contexts/ToastContext'
import { resolvePreviewImageUrl, signedDownloadUrl } from '@/lib/file-attachment-open'

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
  if (mime.startsWith('image/')) return 'IMG'
  if (mime === 'application/pdf') return 'PDF'
  if (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('javascript') ||
    mime.includes('typescript')
  )
    return 'TXT'
  return 'FILE'
}

export default function FileAttachmentCard({ file }: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { showToast } = useToast()
  const mountedRef = useRef(true)

  // Revoke whenever imgUrl is replaced or the card unmounts — the object URL from
  // resolvePreviewImageUrl is otherwise never reclaimed by the browser.
  useEffect(() => {
    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl)
    }
  }, [imgUrl])

  // Must reset to `true` in the effect body, not just `false` in its cleanup: React
  // StrictMode (on by default for App Router since Next 13.5.1, and not overridden in
  // next.config.mjs) dev-mode-only double-invokes this — mount, cleanup, mount again —
  // to catch effects that don't tolerate a simulated remount. Without the reset here,
  // that cleanup's `false` would stick permanently after the very first render, before
  // any click, and every Preview would silently revoke instead of ever setting imgUrl.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function openFile() {
    if (!file.mime_type.startsWith('image/')) {
      // Must be the first thing this does, with no `await` before it: window.open
      // only keeps the click's transient activation if it runs synchronously inside
      // the same task as the click. A pre-flight fetch here (an earlier version of
      // this file had one, to get a catchable error) sits between the click and this
      // call and made Safari/Firefox treat every Download as a blocked pop-up. A
      // blocked pop-up, or the file having been deleted (a 404 in the new tab), isn't
      // caught here — that's the same limitation OutputsPanel's plain
      // `<a target="_blank">` already lives with.
      const opened = window.open(signedDownloadUrl(file.id), '_blank', 'noopener,noreferrer')
      if (!opened) {
        // Same reasoning as the repo's error-boundary allowlist in eslint.config.mjs:
        // the structured logger (lib/logger.ts) is server-only, so the browser console
        // is the only triage sink a client component has for "why did this fail".
        // eslint-disable-next-line no-console
        console.error('openFile failed', new Error('window.open returned null (pop-up blocked?)'))
        showToast(`Couldn't open ${file.filename}.`, 'error')
      }
      return
    }

    setLoading(true)
    try {
      const url = await resolvePreviewImageUrl(file.id)
      // The card can unmount while this fetch is in flight (e.g. the message list
      // re-renders it away). setImgUrl would then be a no-op, so the object URL would
      // never reach the revoke-on-change effect above and leak for the rest of the
      // page session — revoke it directly instead.
      if (mountedRef.current) setImgUrl(url)
      else URL.revokeObjectURL(url)
    } catch (err) {
      // Devtools is the only triage sink here too — see the note above.
      // eslint-disable-next-line no-console
      console.error('openFile failed', err)
      showToast(`Couldn't open ${file.filename}.`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-2 max-w-xs rounded-xl border border-gray-200 bg-white p-3 text-gray-900 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="rounded bg-gray-100 px-1.5 py-1 text-[10px] font-semibold leading-4 text-gray-500">
          {mimeIcon(file.mime_type)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.filename}</div>
          <div className="text-xs text-gray-500">{formatBytes(file.size_bytes)}</div>
        </div>
        <button
          type="button"
          onClick={() => void openFile()}
          disabled={loading}
          className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
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
