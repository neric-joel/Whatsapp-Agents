import { describe, expect, it } from 'vitest'

import { createAgentSchema, updateAgentSchema, upsertCliProfileSchema } from '../api-validation'

const ROOM = '00000000-0000-4000-8000-000000000001'

const valid = {
  room_id: ROOM,
  name: 'My Helper',
  slug: 'my_helper',
  provider: 'mock',
}

describe('createAgentSchema', () => {
  it('accepts a minimal valid agent', () => {
    expect(createAgentSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a system_prompt (delivered to the CLI via stdin, never argv)', () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      system_prompt: '"; rm -rf / # you are a pirate',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown adapter_type (would crash the bridge run-worker)', () => {
    const result = createAgentSchema.safeParse({ ...valid, adapter_type: 'evil-shell' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid slug (uppercase / spaces)', () => {
    expect(createAgentSchema.safeParse({ ...valid, slug: 'Bad Slug' }).success).toBe(false)
  })

  it('rejects a missing room_id (the admin-gated target)', () => {
    const { room_id, ...noRoom } = valid
    void room_id
    expect(createAgentSchema.safeParse(noRoom).success).toBe(false)
  })

  it('rejects an unknown provider', () => {
    expect(createAgentSchema.safeParse({ ...valid, provider: 'definitely-not' }).success).toBe(
      false,
    )
  })

  it('accepts a connected-CLI agent (adapter_type cli + cli_profile_id)', () => {
    const result = createAgentSchema.safeParse({
      ...valid,
      provider: 'custom',
      adapter_type: 'cli',
      cli_profile_id: 'profile-123',
    })
    expect(result.success).toBe(true)
  })
})

describe('upsertCliProfileSchema', () => {
  const valid = {
    name: 'Claude Code',
    slug: 'claude',
    bin: 'claude',
    args: ['--print', '--output-format', 'json'],
    kind: 'claude-code',
    enabled: true,
  }

  it('accepts a valid profile', () => {
    expect(upsertCliProfileSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a minimal manual profile (name, slug, bin only)', () => {
    expect(upsertCliProfileSchema.safeParse({ name: 'X', slug: 'x', bin: 'x' }).success).toBe(true)
  })

  it('rejects an empty bin (nothing to spawn)', () => {
    expect(upsertCliProfileSchema.safeParse({ ...valid, bin: '' }).success).toBe(false)
  })

  it('rejects an invalid slug', () => {
    expect(upsertCliProfileSchema.safeParse({ ...valid, slug: 'Bad Slug' }).success).toBe(false)
  })

  it('rejects an env var name that is not a valid identifier', () => {
    expect(upsertCliProfileSchema.safeParse({ ...valid, env: { '1BAD': 'x' } }).success).toBe(false)
  })

  it('accepts a valid env map', () => {
    expect(upsertCliProfileSchema.safeParse({ ...valid, env: { MY_FLAG: 'true' } }).success).toBe(
      true,
    )
  })
})

describe('updateAgentSchema', () => {
  it('accepts a partial update', () => {
    expect(updateAgentSchema.safeParse({ capabilities: 'now reviews tests' }).success).toBe(true)
  })

  it('accepts disabling via is_active', () => {
    expect(updateAgentSchema.safeParse({ is_active: false }).success).toBe(true)
  })

  it('rejects an empty body', () => {
    expect(updateAgentSchema.safeParse({}).success).toBe(false)
  })
})
