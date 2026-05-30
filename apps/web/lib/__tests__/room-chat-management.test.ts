import { describe, expect, it } from 'vitest'

import { clearRoomChat } from '../room-chat-management'

describe('clearRoomChat', () => {
  it('deletes tool calls, agent runs, and messages in dependency order', async () => {
    const calls: Array<{ table: string; column: string; value: string }> = []
    const supabase = {
      from(table: string) {
        return {
          delete() {
            return {
              async eq(column: string, value: string) {
                calls.push({ table, column, value })
                return { error: null }
              },
            }
          },
        }
      },
    }

    await clearRoomChat(supabase, 'room-1')

    expect(calls).toEqual([
      { table: 'tool_calls', column: 'room_id', value: 'room-1' },
      { table: 'agent_runs', column: 'room_id', value: 'room-1' },
      { table: 'messages', column: 'room_id', value: 'room-1' },
    ])
  })
})
