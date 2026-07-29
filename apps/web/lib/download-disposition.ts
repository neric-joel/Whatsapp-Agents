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
 * Replaces a lone (unpaired) UTF-16 surrogate with U+FFFD. A lone surrogate is
 * not valid Unicode text, and `encodeURIComponent` throws `URIError` on one —
 * which would otherwise crash `contentDispositionHeader` (and the download
 * route) for a filename containing one, the same permanent-500 failure mode as
 * a raw CR/LF. Not reachable through today's browser-upload path (undici
 * replaces a lone surrogate in a `File` name with U+FFFD when it round-trips
 * through `multipart/form-data`), but `contentDispositionHeader` guards
 * already-stored data independent of how it got there, so it guards this too.
 */
function sanitizeLoneSurrogates(s: string): string {
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD',
  )
}

/**
 * Percent-encodes `filename` for the RFC 5987 `ext-value` grammar
 * (`ext-value = charset "'" [language] "'" value-chars`). `encodeURIComponent`
 * alone is not sufficient: it leaves `'`, `(`, `)`, `*`, and `!` unescaped, and
 * `'` is the delimiter that separates `charset`/`language`/`value` in
 * `ext-value` — an unescaped `'` in the filename (e.g. `o'brien.png`) produces a
 * syntactically invalid ext-value that a strict parser (e.g. the
 * `content-disposition` npm package) rejects outright, and a lenient
 * `split("'")` parser silently truncates.
 */
function encodeExtValue(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*!]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
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
 *    (0x20-0x7E), plus `"`, `\`, `;`, and `=` (any of which would either break
 *    out of the quoted string or hand a naive `;`-splitting intermediary — a
 *    proxy, log scrubber, AV scanner — something that looks like a second
 *    parameter), is replaced with `_`. This costs nothing legitimate: the real
 *    name always lives in `filename*` below. Replacing rather than stripping is
 *    also what keeps a raw CR/LF or `"` in a legacy filename from reaching
 *    `new Response(...)`, which throws on invalid header values.
 *  - `filename*=UTF-8''...` — the real filename, run through `encodeExtValue`
 *    (RFC 5987 `ext-value`, not bare `encodeURIComponent` — see above). Modern
 *    browsers prefer this over `filename` when both are present, so it must
 *    never be interpolated raw: encoding, not string-building, is what stops a
 *    `"` in the stored filename from opening a second, attacker-controlled
 *    `filename*` parameter.
 */
export function contentDispositionHeader(
  disposition: 'inline' | 'attachment',
  filename: string,
): string {
  const safeFilename = sanitizeLoneSurrogates(filename)
  const fallback = safeFilename.replace(/[^\x20-\x7e]|[";=\\]/g, '_') || '_'
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeExtValue(safeFilename)}`
}
