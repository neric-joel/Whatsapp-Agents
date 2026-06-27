import { describe, expect, it } from 'vitest'

import { validateServerEnv } from '../env'

// Local single-user app: there are no required server env vars (no Supabase). Only
// optional config is validated when present.
describe('validateServerEnv', () => {
  it('accepts an empty environment (nothing is required)', () => {
    expect(() => validateServerEnv({})).not.toThrow()
  })

  it('accepts a valid NEXT_PUBLIC_APP_URL', () => {
    expect(() => validateServerEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })).not.toThrow()
  })

  it('rejects a malformed NEXT_PUBLIC_APP_URL and names it', () => {
    expect(() => validateServerEnv({ NEXT_PUBLIC_APP_URL: 'nope' })).toThrow(/NEXT_PUBLIC_APP_URL/)
  })
})
