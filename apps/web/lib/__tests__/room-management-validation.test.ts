import { describe, expect, it } from 'vitest'
import { updateRoomArchiveSchema } from '../api-validation'

describe('updateRoomArchiveSchema', () => {
  it('accepts an archive boolean', () => {
    const result = updateRoomArchiveSchema.safeParse({ is_archived: true })

    expect(result.success).toBe(true)
  })

  it('rejects a missing archive flag', () => {
    const result = updateRoomArchiveSchema.safeParse({})

    expect(result.success).toBe(false)
  })
})
