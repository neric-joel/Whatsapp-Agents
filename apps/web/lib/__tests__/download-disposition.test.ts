import { describe, expect, it } from 'vitest'

import {
  contentDispositionHeader,
  isSafeInlineMimeType,
  SAFE_INLINE_DOWNLOAD_MIME_TYPES,
} from '../download-disposition'

describe('isSafeInlineMimeType', () => {
  it('allows only the script-free allowlist inline', () => {
    for (const type of SAFE_INLINE_DOWNLOAD_MIME_TYPES) {
      expect(isSafeInlineMimeType(type)).toBe(true)
    }
  })

  it('never serves SVG inline — it executes script as a top-level document', () => {
    expect(isSafeInlineMimeType('image/svg+xml')).toBe(false)
  })

  it('forces attachment for other active or opaque types', () => {
    for (const type of ['text/html', 'application/pdf', 'application/zip', 'application/xml']) {
      expect(isSafeInlineMimeType(type)).toBe(false)
    }
  })

  it('ignores parameters and casing so a charset cannot force an attachment', () => {
    expect(isSafeInlineMimeType('text/plain; charset=utf-8')).toBe(true)
    expect(isSafeInlineMimeType('IMAGE/PNG')).toBe(true)
  })

  it('treats a missing mime type as unsafe', () => {
    expect(isSafeInlineMimeType(null)).toBe(false)
    expect(isSafeInlineMimeType(undefined)).toBe(false)
    expect(isSafeInlineMimeType('')).toBe(false)
  })
})

/**
 * Splits a header value into its top-level `;`-separated parameters, the way a
 * spec-compliant client does (RFC 2616 quoted-string): a `;` inside a quoted
 * `filename="..."` value is part of that value, not a parameter separator. Used
 * below to prove there is exactly one real `filename*` parameter even when the
 * stored filename contains the literal text "filename*=" — that text is inert
 * once it's inside quotes, and a naive substring search would be fooled by it.
 */
function splitDispositionParams(header: string): string[] {
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

describe('contentDispositionHeader', () => {
  it('emits both filename forms for an ordinary name', () => {
    expect(contentDispositionHeader('attachment', 'report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    )
  })

  it('never lets a quote in the stored filename open a second, attacker-controlled filename* — the exact chart.png/quarterly-report.pdf.exe attack', () => {
    // A real PNG whose stored name tries to smuggle a second `filename*` param
    // that would make browsers save the download as a different, attacker-chosen
    // file — the concrete attack this fix closes.
    const poisoned = `chart.png"; filename*=UTF-8''quarterly-report.pdf.exe; z="`
    const header = contentDispositionHeader('attachment', poisoned)

    const params = splitDispositionParams(header)
    expect(params[0]).toBe('attachment')
    // Exactly one *real* filename* parameter — the literal text "filename*="
    // also appears inside the quoted `filename=` fallback, but that occurrence
    // is inert: it's part of the quoted string's value, not a parameter
    // separator, because the quote characters that would have closed it early
    // were replaced with `_`.
    const starParams = params.filter((p) => p.startsWith("filename*=UTF-8''"))
    expect(starParams).toHaveLength(1)
    // And that one real parameter is the fully percent-encoded original string —
    // never the raw attacker payload a naive parser might extract.
    expect(starParams[0]).toBe(`filename*=UTF-8''${encodeURIComponent(poisoned)}`)
    expect(starParams[0]).not.toBe("filename*=UTF-8''quarterly-report.pdf.exe")
  })

  it('produces a header safe for new Response(...) even for a legacy filename containing raw CR/LF', () => {
    const crlfName = 'evil\r\nfile.png'
    const header = contentDispositionHeader('attachment', crlfName)

    expect(header).not.toMatch(/[\r\n]/)
    // Building an actual Response with this header must not throw (that throw is
    // the permanent-500 symptom the brief describes).
    expect(() => new Response(null, { headers: { 'Content-Disposition': header } })).not.toThrow()
  })

  it('replaces non-ASCII, quotes, and backslashes in the fallback but preserves them (encoded) in filename*', () => {
    const name = 'café "notes"\\v2.txt'
    const header = contentDispositionHeader('inline', name)

    expect(header).toBe(
      `inline; filename="caf_ _notes__v2.txt"; filename*=UTF-8''${encodeURIComponent(name)}`,
    )
  })
})
