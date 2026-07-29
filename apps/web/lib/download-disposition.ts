/**
 * Helpers for the signed-download route's response headers: which MIME types are
 * safe to serve with `Content-Disposition: inline`, and how to build that header
 * safely (see `contentDispositionHeader` below).
 *
 * Serving a file inline makes the browser render it as a top-level document in
 * this app's origin. For `image/svg+xml` that means executing any embedded
 * `<script>` — and the site CSP allows `'unsafe-inline'`, so it is no defense.
 * So inline is an allowlist of types that cannot carry script, and everything
 * else (SVG, PDF, archives, unknown types) is served as an attachment.
 *
 * This lives in `lib/` rather than beside the route because Next.js route files
 * may only export its recognized handler names; exporting anything else makes
 * the generated route validator fail `tsc`.
 */
export const SAFE_INLINE_DOWNLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
] as const

const safeInline = new Set<string>(SAFE_INLINE_DOWNLOAD_MIME_TYPES)

export function isSafeInlineMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false
  // Strip any parameters (`text/plain; charset=utf-8`) before comparing.
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  return safeInline.has(base)
}

/**
 * Builds a `Content-Disposition` header value that stays safe even for a
 * `filename` stored before upload validation rejected quotes and control
 * characters (`isValidUploadFilename` in `lib/api-validation.ts`) — older rows
 * may already contain one, and encoding here, not the upload-time check alone, is
 * what keeps serving them safe.
 *
 * Emits both forms from RFC 6266 so old and new clients agree on the same file:
 *  - `filename=` — an ASCII-safe fallback. Anything outside printable ASCII
 *    (0x20-0x7E), plus `"` and `\` (which would break out of the quoted string),
 *    is replaced with `_`. This is also what keeps a raw CR/LF or `"` in a legacy
 *    filename from reaching `new Response(...)`, which throws on invalid header
 *    values.
 *  - `filename*=UTF-8''...` — the real filename, run through `encodeURIComponent`
 *    (RFC 5987 `ext-value`). Modern browsers prefer this over `filename` when
 *    both are present, so it must never be interpolated raw: encoding, not
 *    string-building, is what stops a `"` in the stored filename from opening a
 *    second, attacker-controlled `filename*` parameter.
 */
export function contentDispositionHeader(
  disposition: 'inline' | 'attachment',
  filename: string,
): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_') || '_'
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
