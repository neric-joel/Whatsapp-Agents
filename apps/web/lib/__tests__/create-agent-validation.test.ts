import { describe, expect, it } from 'vitest'

import { createAgentSchema, updateAgentSchema } from '../api-validation'

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
