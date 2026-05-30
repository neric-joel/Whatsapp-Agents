import { describe, expect, it } from 'vitest'
import { getApiErrorMessage } from '../api-client'
import { addRoomAgentSchema } from '../api-validation'

describe('getApiErrorMessage', () => {
  it('reads API error envelope messages', () => {
    expect(
      getApiErrorMessage({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
      }),
    ).toBe('Unauthorized')
  })

  it('falls back for unknown error shapes', () => {
    expect(getApiErrorMessage({ ok: false }, 'Could not create room')).toBe(
      'Could not create room',
    )
  })
})

describe('addRoomAgentSchema', () => {
  it('requires an agent_id uuid', () => {
    expect(
      addRoomAgentSchema.safeParse({ agent_id: '7e6e4238-672f-4bb8-a36a-97eaa5d25634' }).success,
    ).toBe(true)
    expect(addRoomAgentSchema.safeParse({ agent_id: 'not-a-uuid' }).success).toBe(false)
    expect(addRoomAgentSchema.safeParse({}).success).toBe(false)
  })
})
