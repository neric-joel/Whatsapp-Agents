/**
 * Which MIME types are safe to serve with `Content-Disposition: inline`.
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
