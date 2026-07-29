import { describe, expect, it } from 'vitest'

import { isValidUploadFilename, MAX_UPLOAD_BYTES, signedUploadSchema } from '../api-validation'

describe('signedUploadSchema', () => {
  const valid = { filename: 'photo.png', mime_type: 'image/png', size_bytes: 1024 }

  it('accepts an allowlisted mime type', () => {
    expect(signedUploadSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a non-allowlisted mime type', () => {
    expect(
      signedUploadSchema.safeParse({ ...valid, mime_type: 'application/x-msdownload' }).success,
    ).toBe(false)
  })

  it('rejects path traversal in the filename', () => {
    expect(signedUploadSchema.safeParse({ ...valid, filename: '../etc/passwd' }).success).toBe(
      false,
    )
    expect(signedUploadSchema.safeParse({ ...valid, filename: 'a/b.png' }).success).toBe(false)
    expect(signedUploadSchema.safeParse({ ...valid, filename: '..' }).success).toBe(false)
  })

  it('rejects oversized uploads', () => {
    expect(
      signedUploadSchema.safeParse({ ...valid, size_bytes: MAX_UPLOAD_BYTES + 1 }).success,
    ).toBe(false)
  })

  it('rejects zero/negative sizes', () => {
    expect(signedUploadSchema.safeParse({ ...valid, size_bytes: 0 }).success).toBe(false)
  })

  it('rejects a quote in the filename — it would let an attacker close the quoted filename= parameter early and append their own filename*', () => {
    expect(
      signedUploadSchema.safeParse({
        ...valid,
        filename: `chart.png"; filename*=UTF-8''quarterly-report.pdf.exe; z="`,
      }).success,
    ).toBe(false)
  })

  it('rejects CR/LF in the filename — stored raw, it makes the download routes new Response(...) throw', () => {
    expect(signedUploadSchema.safeParse({ ...valid, filename: 'evil\r\nfile.png' }).success).toBe(
      false,
    )
    expect(signedUploadSchema.safeParse({ ...valid, filename: 'evil\rfile.png' }).success).toBe(
      false,
    )
    expect(signedUploadSchema.safeParse({ ...valid, filename: 'evil\nfile.png' }).success).toBe(
      false,
    )
  })

  it('rejects other ASCII control characters and the backslash path separator', () => {
    expect(signedUploadSchema.safeParse({ ...valid, filename: 'evil\0file.png' }).success).toBe(
      false,
    )
    expect(signedUploadSchema.safeParse({ ...valid, filename: 'a\\b.png' }).success).toBe(false)
  })
})

describe('isValidUploadFilename', () => {
  it('accepts an ordinary filename', () => {
    expect(isValidUploadFilename('photo.png')).toBe(true)
  })

  it('rejects quotes, control characters, path separators, and traversal — the same rule enforced by both the signed-upload route and signedUploadSchema', () => {
    expect(isValidUploadFilename('chart.png"; z="')).toBe(false)
    expect(isValidUploadFilename('evil\r\nfile.png')).toBe(false)
    expect(isValidUploadFilename('a/b.png')).toBe(false)
    expect(isValidUploadFilename('a\\b.png')).toBe(false)
    expect(isValidUploadFilename('.')).toBe(false)
    expect(isValidUploadFilename('..')).toBe(false)
    expect(isValidUploadFilename('')).toBe(false)
    expect(isValidUploadFilename('a'.repeat(256))).toBe(false)
  })
})
