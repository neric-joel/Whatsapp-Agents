import { describe, expect, it } from 'vitest'

import { validateServerEnv } from '../env'

const VALID: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pub-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
}

describe('validateServerEnv', () => {
  it('accepts a minimal valid environment', () => {
    expect(() => validateServerEnv({ ...VALID })).not.toThrow()
  })

  it('throws and names a missing publishable key', () => {
    const { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: _omit, ...rest } = VALID
    expect(() => validateServerEnv(rest)).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('throws and names a missing service-role key', () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _omit, ...rest } = VALID
    expect(() => validateServerEnv(rest)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('rejects a non-URL Supabase URL', () => {
    expect(() => validateServerEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: 'nope' })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    )
  })

  it('guides the operator who used the deprecated ANON_KEY name', () => {
    const { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: _omit, ...rest } = VALID
    expect(() => validateServerEnv({ ...rest, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy' })).toThrow(
      /PUBLISHABLE_KEY/,
    )
  })
})
