import { describe, expect, it } from 'vitest'
import { getBearerToken } from '../api-auth'

describe('getBearerToken', () => {
  it('returns the token from an Authorization bearer header', () => {
    const req = { headers: new Headers({ Authorization: 'Bearer test.jwt.token' }) }

    expect(getBearerToken(req)).toBe('test.jwt.token')
  })

  it('returns null when the authorization header is not bearer auth', () => {
    const req = { headers: new Headers({ Authorization: 'Basic abc123' }) }

    expect(getBearerToken(req)).toBeNull()
  })
})
