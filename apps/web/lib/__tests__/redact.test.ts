import { redact } from '@agentroom/shared'
import { describe, expect, it } from 'vitest'

describe('redact', () => {
  it('redacts long base64-like strings', () => {
    const value = 'VGhpcyBpcyBhIHNlY3JldCB2YWx1ZSB0aGF0IHNob3VsZCBiZSBoaWRkZW4='

    expect(redact(`payload=${value}`)).toBe('payload=[REDACTED:base64]')
  })

  it('redacts JWT tokens', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdHNpZ25hdHVyZQ'

    expect(redact(`token=${token}`)).toBe('token=[REDACTED:jwt]')
  })
})
