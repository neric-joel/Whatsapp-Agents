/**
 * Client-side helpers for FileAttachmentCard's Preview/Download button.
 *
 * The route these call — `app/api/files/[fileId]/signed-download/route.ts` — answers a
 * success (200) with the file's raw bytes and headers, not a JSON envelope (only its
 * error responses, built with `lib/api-error.ts`'s `apiError`, are JSON). So nothing
 * here ever calls `res.json()` on it; a prior version of the caller did exactly that
 * and threw a JSON-parse error on every successful click.
 */

import { isSafeInlineMimeType } from './download-disposition'

export function signedDownloadUrl(fileId: string): string {
  return `/api/files/${fileId}/signed-download`
}

/**
 * Whether the Preview path may be used for a file, i.e. whether its bytes may be
 * turned into a same-origin `blob:` URL and rendered in an `<img>`.
 *
 * Two conditions, and the security half is deliberately NOT its own rule:
 *
 *  - `isSafeInlineMimeType` — the SAME allowlist the signed-download route uses to
 *    choose `inline` vs `attachment`. It must be, because Preview strips the
 *    protection that made a non-allowlisted type safe to serve at all: the route
 *    answers with `Content-Security-Policy: default-src 'none'; sandbox`, but a
 *    `blob:` URL built from those bytes is a fresh same-origin document carrying
 *    none of it. `startsWith('image/')` (what this used to be) includes
 *    `image/svg+xml`, which upload validation allows on purpose. Rendering an SVG
 *    in `<img>` is inert, but the object URL it needs is reachable by hand —
 *    right-click → "Open image in new tab" navigates to a CSP-less same-origin
 *    document where the SVG's `<script>` runs with this app's full API authority.
 *    So Preview and the route now answer the same question with the same code.
 *  - the type is actually an image — `text/plain` is on the inline allowlist (it
 *    cannot carry script) but an `<img>` cannot display it, so it stays a Download.
 */
export function canPreviewInline(mimeType: string | null | undefined): boolean {
  if (!isSafeInlineMimeType(mimeType)) return false
  const base = mimeType?.split(';')[0]?.trim().toLowerCase() ?? ''
  return base.startsWith('image/')
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
  // Second gate, on the server's own answer rather than the row the client rendered
  // from: the object URL is created HERE, so this is the last point at which the
  // CSP-less same-origin document can still be refused. The route already told us
  // which way it classified these bytes (`Content-Type`), so a caller that reached
  // here for a type the route would only ever serve as an attachment is a bug —
  // fail rather than mint the URL.
  const served = res.headers.get('content-type')
  if (!canPreviewInline(served)) {
    throw new Error(
      `signed-download served ${served ?? 'an unknown type'}, which is not previewable`,
    )
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
