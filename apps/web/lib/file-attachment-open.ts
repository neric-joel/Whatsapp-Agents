/**
 * Client-side helpers for FileAttachmentCard's Preview/Download button.
 *
 * The route these call — `app/api/files/[fileId]/signed-download/route.ts` — answers a
 * success (200) with the file's raw bytes and headers, not a JSON envelope (only its
 * error responses, built with `lib/api-error.ts`'s `apiError`, are JSON). So nothing
 * here ever calls `res.json()` on it; a prior version of the caller did exactly that
 * and threw a JSON-parse error on every successful click.
 */

export function signedDownloadUrl(fileId: string): string {
  return `/api/files/${fileId}/signed-download`
}

/**
 * Fetches the file and returns an object URL for inline `<img>` display. The caller
 * owns the returned URL and must `URL.revokeObjectURL` it once it's no longer shown
 * (replaced by a new one, or the component unmounts) — the browser never reclaims it
 * on its own.
 */
export async function resolvePreviewImageUrl(fileId: string): Promise<string> {
  const res = await fetch(signedDownloadUrl(fileId))
  if (!res.ok) throw new Error(`signed-download responded ${res.status}`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/**
 * Confirms the file is actually retrievable before the caller opens a new tab at
 * `signedDownloadUrl(fileId)`. Deliberately does not read the body as a Blob and hand
 * it back: a browser navigating straight to the route observes that response's real
 * `Content-Disposition: attachment` (and CSP/nosniff) headers, which a same-origin
 * Blob URL — stripped of the original response's headers — would not carry. This only
 * needs the status, so it cancels the unread body rather than holding the connection
 * open for bytes nobody will read.
 */
export async function confirmDownloadable(fileId: string): Promise<void> {
  const res = await fetch(signedDownloadUrl(fileId))
  await res.body?.cancel()
  if (!res.ok) throw new Error(`signed-download responded ${res.status}`)
}
