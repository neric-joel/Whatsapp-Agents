import { describe, expect, it } from 'vitest'

import {
  contentDispositionHeader,
  isSafeInlineMimeType,
  SAFE_INLINE_DOWNLOAD_MIME_TYPES,
} from '../download-disposition'
import { splitDispositionParams } from './disposition-params'

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
    // separator, because the quote/`;`/`=` characters that would have made it
    // look like one were replaced with `_`.
    const starParams = params.filter((p) => p.startsWith("filename*=UTF-8''"))
    expect(starParams).toHaveLength(1)
    // And that one real parameter is the fully percent-encoded original string —
    // never the raw attacker payload a naive parser might extract. The `'` and
    // `*` in the payload are RFC 5987 ext-value-significant, so the real
    // encoder (encodeExtValue) escapes them too, on top of encodeURIComponent.
    const expectedStar = encodeURIComponent(poisoned).replace(
      /['()*!]/g,
      (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
    )
    expect(starParams[0]).toBe(`filename*=UTF-8''${expectedStar}`)
    expect(starParams[0]).not.toBe("filename*=UTF-8''quarterly-report.pdf.exe")
  })

  it("percent-encodes a single quote in filename* — bare encodeURIComponent leaves it raw, and ' is the RFC 8187 ext-value delimiter", () => {
    // encodeURIComponent("o'brien.png") === "o'brien.png": the quote is left
    // unescaped. But `ext-value = charset "'" [language] "'" value-chars` uses
    // `'` as a structural delimiter, and `'` is not a valid `value-chars`
    // character — an unescaped `'` here is a spec-invalid ext-value that a
    // strict parser (the `content-disposition` npm package) rejects outright,
    // and a lenient `split("'")` parser truncates.
    const header = contentDispositionHeader('attachment', "o'brien.png")

    expect(header).toContain("filename*=UTF-8''o%27brien.png")
    expect(header).not.toContain("filename*=UTF-8''o'brien.png")
  })

  it('produces a header safe for new Response(...) even for a legacy filename containing raw CR/LF', () => {
    const crlfName = 'evil\r\nfile.png'
    const header = contentDispositionHeader('attachment', crlfName)

    expect(header).not.toMatch(/[\r\n]/)
    // Building an actual Response with this header must not throw (that throw is
    // the permanent-500 symptom the brief describes).
    expect(() => new Response(null, { headers: { 'Content-Disposition': header } })).not.toThrow()
  })

  it('produces a header safe for new Response(...) even for a legacy filename containing a lone UTF-16 surrogate', () => {
    // encodeURIComponent throws URIError on an unpaired surrogate — a different
    // character class than CR/LF, but the same permanent-500 failure mode this
    // function exists to prevent for already-stored data.
    const loneSurrogateName = 'a\uD800b.png'
    expect(() => encodeURIComponent(loneSurrogateName)).toThrow(URIError)

    const header = contentDispositionHeader('attachment', loneSurrogateName)
    expect(() => new Response(null, { headers: { 'Content-Disposition': header } })).not.toThrow()
    expect(header).toBe(`attachment; filename="a_b.png"; filename*=UTF-8''a%EF%BF%BDb.png`)
  })

  it('replaces non-ASCII, quotes, backslashes, semicolons, and equals signs in the fallback but preserves the real name (encoded) in filename*', () => {
    // `;` and `=` are legal printable ASCII and don't break the quoted string,
    // but a naive `;`-splitting intermediary (a proxy, a log scrubber, an AV
    // scanner) that isn't quoted-string aware could still be misled by them —
    // so the fallback replaces them too. Costs nothing legitimate: the real
    // name always lives in filename*.
    const name = 'café "notes"\\;version=2.txt'
    const header = contentDispositionHeader('inline', name)

    expect(header).toBe(
      `inline; filename="caf_ _notes___version_2.txt"; filename*=UTF-8''${encodeURIComponent(name)}`,
    )
  })
})
