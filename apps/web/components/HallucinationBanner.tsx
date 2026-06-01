'use client'

import { useState } from 'react'

import type { HallucinationMeta } from '@/lib/hallucination-detector'

interface HallucinationBannerProps {
  meta: HallucinationMeta
  messageId: string
  onDismiss: () => void
}

export default function HallucinationBanner({
  meta,
  messageId,
  onDismiss,
}: HallucinationBannerProps) {
  const [submitting, setSubmitting] = useState<'accept' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(accepted: boolean) {
    setSubmitting(accepted ? 'accept' : 'reject')
    setError(null)

    try {
      const res = await fetch(`/api/messages/${messageId}/hallucination`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted }),
      })

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        setError(json?.error?.message ?? 'Failed to update review')
        return
      }

      onDismiss()
    } catch {
      setError('Failed to update review')
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">Potentially inaccurate response</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {meta.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="mt-1 text-yellow-800">Confidence: {meta.confidence}</p>
          {error && <p className="mt-1 text-red-700">{error}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={submitting !== null}
            className="rounded-md border border-yellow-400 bg-white px-2.5 py-1 font-medium text-yellow-900 transition-colors hover:bg-yellow-100 disabled:opacity-50"
          >
            {submitting === 'accept' ? 'Saving...' : 'Accept'}
          </button>
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={submitting !== null}
            className="rounded-md bg-yellow-700 px-2.5 py-1 font-medium text-white transition-colors hover:bg-yellow-800 disabled:opacity-50"
          >
            {submitting === 'reject' ? 'Saving...' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}
