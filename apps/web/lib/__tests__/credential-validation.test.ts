import { describe, expect, it } from 'vitest'

import { createCredentialSchema } from '../api-validation'

describe('createCredentialSchema (WS2 / ADR-0010)', () => {
  it('accepts a valid credential', () => {
    const r = createCredentialSchema.safeParse({
      provider: 'openai',
      label: 'My OpenAI key',
      secret: 'sk-abc123',
      is_default: true,
    })
    expect(r.success).toBe(true)
  })

  it('accepts an optional https base_url', () => {
    const r = createCredentialSchema.safeParse({
      provider: 'codex',
      label: 'Azure',
      secret: 'sk-x',
      base_url: 'https://my-azure.openai.azure.com/v1',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a non-https base_url (SSRF/mixed-content guard)', () => {
    const r = createCredentialSchema.safeParse({
      provider: 'openai',
      label: 'x',
      secret: 'sk',
      base_url: 'http://insecure.example',
    })
    expect(r.success).toBe(false)
  })

  it('requires a non-empty secret', () => {
    expect(
      createCredentialSchema.safeParse({ provider: 'openai', label: 'x', secret: '' }).success,
    ).toBe(false)
  })

  it('rejects an unknown provider', () => {
    expect(
      createCredentialSchema.safeParse({ provider: 'not-a-provider', label: 'x', secret: 'sk' })
        .success,
    ).toBe(false)
  })
})
