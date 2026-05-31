import { describe, expect, it } from 'vitest'

import {
  createMemorySchema,
  createPinSchema,
  createRoomSchema,
  sendMessageSchema,
  updateMemorySchema,
  updatePinSchema,
} from '../api-validation'

describe('createRoomSchema', () => {
  it('accepts a minimal valid room', () => {
    expect(createRoomSchema.safeParse({ name: 'My Room' }).success).toBe(true)
  })
  it('rejects an empty name', () => {
    expect(createRoomSchema.safeParse({ name: '' }).success).toBe(false)
  })
  it('rejects a name over 100 chars', () => {
    expect(createRoomSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
  })
  it('rejects an invalid reply_mode enum', () => {
    expect(createRoomSchema.safeParse({ name: 'r', reply_mode: 'nonsense' }).success).toBe(false)
  })
  it('accepts valid optional enums', () => {
    expect(
      createRoomSchema.safeParse({
        name: 'r',
        reply_mode: 'mentioned_only',
        discussion_mode: 'tag_turns',
        visibility: 'public',
      }).success,
    ).toBe(true)
  })
})

describe('sendMessageSchema', () => {
  it('accepts a minimal message', () => {
    expect(sendMessageSchema.safeParse({ content: 'hello' }).success).toBe(true)
  })
  it('rejects empty content', () => {
    expect(sendMessageSchema.safeParse({ content: '' }).success).toBe(false)
  })
  it('rejects a non-uuid reply_to_id', () => {
    expect(sendMessageSchema.safeParse({ content: 'x', reply_to_id: 'not-a-uuid' }).success).toBe(
      false,
    )
  })
  it('rejects a non-uuid in target_agent_ids', () => {
    expect(sendMessageSchema.safeParse({ content: 'x', target_agent_ids: ['nope'] }).success).toBe(
      false,
    )
  })
  it('rejects a negative round_index', () => {
    expect(sendMessageSchema.safeParse({ content: 'x', round_index: -1 }).success).toBe(false)
  })
  it('accepts a full valid payload', () => {
    expect(
      sendMessageSchema.safeParse({
        content: 'hi',
        reply_to_id: '00000000-0000-4000-8000-000000000001',
        target_agent_ids: ['00000000-0000-4000-8000-000000000002'],
        round_index: 1,
        hop_index: 0,
        metadata: { file_ids: [] },
      }).success,
    ).toBe(true)
  })
})

describe('createPinSchema', () => {
  it('requires pin_type', () => {
    expect(createPinSchema.safeParse({}).success).toBe(false)
  })
  it('accepts a valid pin', () => {
    expect(createPinSchema.safeParse({ pin_type: 'context', title: 'T' }).success).toBe(true)
  })
  it('rejects an invalid visibility enum', () => {
    expect(createPinSchema.safeParse({ pin_type: 'context', visibility: 'nope' }).success).toBe(
      false,
    )
  })
  it('rejects a non-uuid source_message_id', () => {
    expect(createPinSchema.safeParse({ pin_type: 'context', source_message_id: 'x' }).success).toBe(
      false,
    )
  })
})

describe('updatePinSchema', () => {
  it('rejects an empty update', () => {
    expect(updatePinSchema.safeParse({}).success).toBe(false)
  })
  it('accepts a single field', () => {
    expect(updatePinSchema.safeParse({ is_active: false }).success).toBe(true)
  })
})

describe('createMemorySchema', () => {
  it('accepts minimal content', () => {
    expect(createMemorySchema.safeParse({ content: 'remember this' }).success).toBe(true)
  })
  it('rejects empty content', () => {
    expect(createMemorySchema.safeParse({ content: '' }).success).toBe(false)
  })
  it('rejects content over the 8000-char cap', () => {
    expect(createMemorySchema.safeParse({ content: 'x'.repeat(8001) }).success).toBe(false)
  })
  it('accepts a full valid payload', () => {
    expect(
      createMemorySchema.safeParse({
        content: 'I prefer concise answers',
        scope: 'global',
        kind: 'preference',
        title: 'tone',
      }).success,
    ).toBe(true)
  })
  it('rejects an unknown kind', () => {
    expect(createMemorySchema.safeParse({ content: 'x', kind: 'bogus' }).success).toBe(false)
  })
})

describe('updateMemorySchema', () => {
  it('rejects an empty update', () => {
    expect(updateMemorySchema.safeParse({}).success).toBe(false)
  })
  it('accepts pinned toggle', () => {
    expect(updateMemorySchema.safeParse({ pinned: true }).success).toBe(true)
  })
  it('accepts is_active toggle (forget)', () => {
    expect(updateMemorySchema.safeParse({ is_active: false }).success).toBe(true)
  })
})
