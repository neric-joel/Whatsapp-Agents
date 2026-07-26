import { describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  roomGet: vi.fn(),
  messagesAll: vi.fn(),
  prepareSql: [] as string[],
}))

vi.mock('@agentroom/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      db.prepareSql.push(sql)
      if (sql.includes('FROM rooms')) {
        return { get: db.roomGet }
      }
      if (sql.includes('FROM messages')) {
        return { all: db.messagesAll }
      }
      return {
        get: vi.fn(),
        run: vi.fn(),
        all: vi.fn(),
      }
    },
  }),
  jsonText: JSON.stringify,
  newId: () => '00000000-0000-4000-8000-000000000001',
  rowToMessage: (row: Record<string, unknown>) => row,
}))

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: () =>
    Promise.resolve({
      data: { user: { id: 'local-user' } },
      error: null,
    }),
}))

import { GET } from './route'

describe('GET /api/rooms/[roomId]/messages', () => {
  it('returns 404 for a missing room before listing messages', async () => {
    db.roomGet.mockReturnValue(undefined)
    db.messagesAll.mockReturnValue([])

    const res = await GET(new Request('http://localhost:3000/api') as never, {
      params: Promise.resolve({ roomId: 'missing-room' }),
    })

    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Room not found' },
    })
    expect(res.status).toBe(404)
    expect(db.roomGet).toHaveBeenCalledWith('missing-room')
    expect(db.messagesAll).not.toHaveBeenCalled()
  })
})
