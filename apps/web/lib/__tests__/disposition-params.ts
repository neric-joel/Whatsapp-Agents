/**
 * Test-only helper: splits a `Content-Disposition` header value into its
 * top-level `;`-separated parameters the way a spec-compliant client does
 * (RFC 2616 quoted-string): a `;` inside a quoted `filename="..."` value is
 * part of that value, not a parameter separator. A stored filename can contain
 * the literal text "filename*=" and have it land — inertly — inside the quoted
 * fallback; only this parser (not a raw substring search) tells the real
 * `filename*` parameter apart from that inert text.
 *
 * Shared between download-disposition.test.ts and the signed-download
 * route.test.ts so the two don't carry independent copies of the same parser.
 */
export function splitDispositionParams(header: string): string[] {
  const parts: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes
    if (ch === ';' && !inQuotes) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current.trim())
  return parts
}
