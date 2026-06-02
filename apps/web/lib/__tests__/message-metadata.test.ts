import { describe, expect, it } from 'vitest'

import { stripServerOwnedMetadata } from '../message-metadata'

describe('stripServerOwnedMetadata (security: server owns metadata.discussion)', () => {
  it('removes a client-supplied discussion block (forgery defense)', () => {
    const forged = {
      file_ids: ['f1'],
      discussion: {
        enabled: true,
        phase: 'converge',
        original_message_id: 'victim-thread-root',
        original_prompt: 'x',
      },
    }
    const safe = stripServerOwnedMetadata(forged)
    expect(safe).not.toHaveProperty('discussion')
    expect(safe).toEqual({ file_ids: ['f1'] }) // other client metadata preserved
  })

  it('handles null/undefined/non-object', () => {
    expect(stripServerOwnedMetadata(null)).toEqual({})
    expect(stripServerOwnedMetadata(undefined)).toEqual({})
  })

  it('passes through metadata that has no discussion key', () => {
    expect(stripServerOwnedMetadata({ a: 1, b: 'two' })).toEqual({ a: 1, b: 'two' })
  })
})
