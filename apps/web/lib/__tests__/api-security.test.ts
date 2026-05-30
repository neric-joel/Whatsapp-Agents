import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  __resetRateLimits,
  allowedOrigins,
  checkRateLimit,
  enforceRateLimit,
  isForbiddenCrossOrigin,
} from '../api-security'

function req(
  method: string,
  headers: Record<string, string>,
  url = 'https://app.example.com/api/x',
) {
  return { method, headers: new Headers(headers), url }
}

describe('isForbiddenCrossOrigin', () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  })
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = prev
  })

  it('ignores safe (non-mutating) methods', () => {
    expect(isForbiddenCrossOrigin(req('GET', { origin: 'https://evil.example.com' }))).toBe(false)
  })

  it('rejects a cross-origin cookie POST', () => {
    expect(isForbiddenCrossOrigin(req('POST', { origin: 'https://evil.example.com' }))).toBe(true)
  })

  it('allows a same-origin POST', () => {
    expect(isForbiddenCrossOrigin(req('POST', { origin: 'https://app.example.com' }))).toBe(false)
  })

  it('rejects a mutating request with no Origin header (cookie auth)', () => {
    expect(isForbiddenCrossOrigin(req('DELETE', {}))).toBe(true)
  })

  it('exempts Bearer-authenticated requests (not CSRF-prone)', () => {
    expect(
      isForbiddenCrossOrigin(
        req('POST', { authorization: 'Bearer abc.def', origin: 'https://evil.example.com' }),
      ),
    ).toBe(false)
  })

  it('honors EXTRA_ALLOWED_ORIGINS', () => {
    process.env.EXTRA_ALLOWED_ORIGINS = 'https://proxy.example.com'
    expect(isForbiddenCrossOrigin(req('POST', { origin: 'https://proxy.example.com' }))).toBe(false)
    delete process.env.EXTRA_ALLOWED_ORIGINS
  })
})

describe('allowedOrigins', () => {
  it('includes the app url origin', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/some/path'
    expect(allowedOrigins()).toContain('https://app.example.com')
  })
})

describe('rate limiter', () => {
  beforeEach(() => __resetRateLimits())

  it('allows up to the limit then blocks', () => {
    const key = 'user:room'
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 60_000, 1000).ok).toBe(true)
    }
    const blocked = checkRateLimit(key, 3, 60_000, 1000)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('resets after the window elapses', () => {
    const key = 'user:room2'
    checkRateLimit(key, 1, 1000, 1000)
    expect(checkRateLimit(key, 1, 1000, 1500).ok).toBe(false)
    expect(checkRateLimit(key, 1, 1000, 2100).ok).toBe(true)
  })

  it('enforceRateLimit returns a 429 response when exceeded', () => {
    const key = 'user:room3'
    expect(enforceRateLimit(key, 1, 60_000)).toBeNull()
    const res = enforceRateLimit(key, 1, 60_000)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
  })
})
