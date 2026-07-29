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
 *
 * There is deliberately no equivalent pre-flight helper for Download: Download opens
 * `signedDownloadUrl(fileId)` directly (see FileAttachmentCard.tsx) so the browser's
 * own navigation observes the route's real `Content-Disposition`/CSP headers, and so
 * `window.open` runs synchronously inside the click handler — an `await` in between,
 * as an earlier version of this file had, loses the click's transient activation in
 * Safari/Firefox and makes every Download silently pop-up-blocked.
 */
export async function resolvePreviewImageUrl(fileId: string): Promise<string> {
  const res = await fetch(signedDownloadUrl(fileId))
  if (!res.ok) throw new Error(`signed-download responded ${res.status}`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
