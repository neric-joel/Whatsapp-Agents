import { describe, expect, it } from 'vitest'

import { addRoomAgentSchema, updateRoomAgentMemberSchema } from '../api-validation'

describe('addRoomAgentSchema', () => {
  it('accepts an agent id', () => {
    const result = addRoomAgentSchema.safeParse({ agentId: '00000000-0000-4000-8000-000000000001' })

    expect(result.success).toBe(true)
  })

  it('rejects a missing agent id', () => {
    const result = addRoomAgentSchema.safeParse({})

    expect(result.success).toBe(false)
  })
})

describe('updateRoomAgentMemberSchema', () => {
  it('accepts a muted boolean', () => {
    const result = updateRoomAgentMemberSchema.safeParse({ muted: true })

    expect(result.success).toBe(true)
  })

  it('rejects an empty body', () => {
    const result = updateRoomAgentMemberSchema.safeParse({})

    expect(result.success).toBe(false)
  })
})
