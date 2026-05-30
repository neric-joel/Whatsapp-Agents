import { describe, expect, it } from 'vitest'
import { MAX_UPLOAD_BYTES, signedUploadSchema } from '../api-validation'

describe('signedUploadSchema', () => {
  const valid = { filename: 'photo.png', mime_type: 'image/png', size_bytes: 1024 }

  it('accepts an allowlisted mime type', () => {
    expect(signedUploadSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a non-allowlisted mime type', () => {
    expect(signedUploadSchema.safeParse({ ...valid, mime_type: 'application/x-msdownload' }).success).toBe(false)
  })

  it('rejects path traversal in the filename', () => {
    expect(signedUploadSchema.safeParse({ ...valid, filename: '../etc/passwd' }).success).toBe(false)
    expect(signedUploadSchema.safeParse({ ...valid, filename: 'a/b.png' }).success).toBe(false)
    expect(signedUploadSchema.safeParse({ ...valid, filename: '..' }).success).toBe(false)
  })

  it('rejects oversized uploads', () => {
    expect(signedUploadSchema.safeParse({ ...valid, size_bytes: MAX_UPLOAD_BYTES + 1 }).success).toBe(false)
  })

  it('rejects zero/negative sizes', () => {
    expect(signedUploadSchema.safeParse({ ...valid, size_bytes: 0 }).success).toBe(false)
  })
})
