import { randomBytes } from 'node:crypto'

import { redact, redactDeep } from '@agentroom/shared'
import { describe, expect, it } from 'vitest'

// Key bodies are GENERATED base64url, never hand-typed: a typed fixture has an
// unrealistically long alphanumeric run and is caught by the generic base64 rule
// even when the provider-key rules are missing, so it proves nothing.
const antKey = () => `sk-ant-api03-${randomBytes(72).toString('base64url')}`
const projKey = () => `sk-proj-${randomBytes(72).toString('base64url')}`

describe('redact', () => {
  it('redacts long base64-like strings', () => {
    const value = 'VGhpcyBpcyBhIHNlY3JldCB2YWx1ZSB0aGF0IHNob3VsZCBiZSBoaWRkZW4='

    expect(redact(`payload=${value}`)).toBe('payload=[REDACTED:base64]')
  })

  it('redacts JWT tokens', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdHNpZ25hdHVyZQ'

    expect(redact(`token=${token}`)).toBe('token=[REDACTED:jwt]')
  })

  it('redacts realistic Anthropic and OpenAI keys in every context they leak through', () => {
    for (let i = 0; i < 50; i++) {
      for (const key of [antKey(), projKey()]) {
        for (const text of [
          key,
          `Sure, the key I found is ${key} and it works.`,
          `{"provider":"anthropic","apiKey":"${key}"}`,
          `Authorization: Bearer ${key}`,
          `ANTHROPIC_API_KEY=${key}`,
        ]) {
          expect(redact(text)).not.toContain(key)
          // no fragment of the body survives either
          expect(redact(text)).not.toContain(key.slice(40, 60))
        }
      }
    }
  })

  it('redacts a whitespace-separated label and a Bearer value', () => {
    expect(redact('api key: hunter2hunter2')).toBe('[REDACTED]')
    expect(redact('authorization: Bearer hunter2hunter2')).toBe('[REDACTED]')
  })

  it('is idempotent', () => {
    const once = redact(`Authorization: Bearer ${antKey()}`)
    expect(redact(once)).toBe(once)
  })
})

describe('redactDeep', () => {
  it('redacts by key name regardless of the value shape', () => {
    const out = redactDeep({
      apiKey: 'plain-not-a-known-format',
      password: 'letmein',
      run_id: 'r1',
    }) as Record<string, unknown>

    expect(out.apiKey).toBe('[REDACTED]')
    expect(out.password).toBe('[REDACTED]')
    expect(out.run_id).toBe('r1')
  })
})
