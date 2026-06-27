import { getDb } from '@agentroom/db'

/**
 * Clear a room's conversation: delete its tool_calls, agent_runs, and messages
 * (in FK-safe order) in a single transaction. Used by the "clear chat" action and
 * room reset. Pins/files are intentionally left intact, matching prior behavior.
 */
export async function clearRoomChat(roomId: string): Promise<void> {
  const db = getDb()
  const tx = db.transaction((rid: string) => {
    for (const table of ['tool_calls', 'agent_runs', 'messages']) {
      db.prepare(`DELETE FROM ${table} WHERE room_id = ?`).run(rid)
    }
  })
  tx(roomId)
}
