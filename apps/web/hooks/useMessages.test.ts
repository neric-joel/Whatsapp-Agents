import { describe, expect, it } from 'vitest'

import { messagesForRoom, shouldApplyMessagesResponse } from './useMessages'

describe('useMessages stale room guards', () => {
  it('hides cached messages that belong to a previous room', () => {
    expect(
      messagesForRoom(
        {
          roomId: 'room-a',
          messages: [
            {
              id: 'msg-a',
              content: 'from room A',
              sender_type: 'user',
              sender_user_id: null,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
              sender_agent_id: null,
              reply_to_id: null,
              metadata: {},
              agents: null,
            },
          ],
        },
        'room-b',
      ),
    ).toEqual([])
  })

  it('rejects responses for old rooms or superseded polls', () => {
    expect(shouldApplyMessagesResponse('room-a', 'room-a', 2, 2)).toBe(true)
    expect(shouldApplyMessagesResponse('room-a', 'room-b', 2, 2)).toBe(false)
    expect(shouldApplyMessagesResponse('room-a', 'room-a', 1, 2)).toBe(false)
  })
})
