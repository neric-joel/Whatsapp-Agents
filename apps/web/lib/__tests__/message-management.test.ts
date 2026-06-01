import { describe, expect, it } from 'vitest'

import {
  canCurrentUserDeleteMessage,
  createDeletedMessagePatch,
  DELETED_MESSAGE_CONTENT,
} from '../message-management'

describe('message management', () => {
  it('allows a user to delete only their own user message', () => {
    expect(
      canCurrentUserDeleteMessage({ sender_type: 'user', sender_user_id: 'user-1' }, 'user-1'),
    ).toBe(true)
    expect(
      canCurrentUserDeleteMessage({ sender_type: 'user', sender_user_id: 'user-2' }, 'user-1'),
    ).toBe(false)
    expect(
      canCurrentUserDeleteMessage({ sender_type: 'agent', sender_user_id: null }, 'user-1'),
    ).toBe(false)
  })

  it('creates the soft-delete update patch', () => {
    expect(createDeletedMessagePatch()).toEqual({ content: DELETED_MESSAGE_CONTENT })
  })
})
