import { describe, expect, it, vi } from 'vitest'

// Mock the local DB layer (avoids loading the native better-sqlite3 module in vitest).
// clearRoomChat runs `db.transaction(fn)(roomId)` where fn does
// `db.prepare('DELETE FROM <t> WHERE room_id = ?').run(roomId)` for each table.
const runSql: string[] = []
const fakeDb = {
  transaction: (fn: (rid: string) => void) => (rid: string) => fn(rid),
  prepare: (sql: string) => ({
    run: () => {
      runSql.push(sql)
    },
  }),
}
vi.mock('@agentroom/db', () => ({ getDb: () => fakeDb }))

import { clearRoomChat } from '../room-chat-management'

describe('clearRoomChat', () => {
  it('deletes tool_calls, agent_runs, and messages in dependency order', async () => {
    runSql.length = 0
    await clearRoomChat('room-1')
    const tables = runSql.map((s) => s.match(/DELETE FROM (\w+)/)?.[1])
    expect(tables).toEqual(['tool_calls', 'agent_runs', 'messages'])
  })
})
