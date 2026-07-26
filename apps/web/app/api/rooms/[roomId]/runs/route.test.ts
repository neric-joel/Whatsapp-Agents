import { describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  runsAll: vi.fn(),
  prepareSql: [] as string[],
}))

vi.mock('@agentroom/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      db.prepareSql.push(sql)
      if (sql.includes('FROM agent_runs')) return { all: db.runsAll }
      return { all: vi.fn(), get: vi.fn(), run: vi.fn() }
    },
  }),
  rowToAgentRun: (row: Record<string, unknown>) => row,
}))

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: () =>
    Promise.resolve({
      data: { user: { id: 'local-user' } },
      error: null,
    }),
}))

vi.mock('@/lib/permissions', () => ({
  requireRoomMember: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from './route'

describe('GET /api/rooms/[roomId]/runs', () => {
  it('caps run history at 200 newest rows', async () => {
    db.prepareSql.length = 0
    db.runsAll.mockReturnValue([])

    const res = await GET(new Request('http://localhost:3000/api') as never, {
      params: Promise.resolve({ roomId: 'room-1' }),
    })

    expect(res).toBeDefined()
    if (!res) throw new Error('expected a response')
    await expect(res.json()).resolves.toEqual({ ok: true, data: [] })
    expect(res.status).toBe(200)
    expect(db.runsAll).toHaveBeenCalledWith('room-1')
    expect(db.prepareSql.join('\n')).toMatch(/ORDER BY r\.created_at DESC\s+LIMIT 200/)
  })
})
