import { describe, expect, it } from 'vitest'

import { isSafeInlineMimeType, SAFE_INLINE_DOWNLOAD_MIME_TYPES } from '../download-disposition'

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
