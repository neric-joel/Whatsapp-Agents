import { describe, expect, it, vi } from 'vitest'

// Mock the local DB layer (avoids loading the native better-sqlite3 module in vitest).
const getMock = vi.fn()
vi.mock('@agentroom/db', () => ({
  getDb: () => ({ prepare: () => ({ get: getMock }) }),
}))

import { checkDatabase } from '../health'

describe('checkDatabase', () => {
  it('reports up with a latency when the DB query succeeds', async () => {
    getMock.mockReturnValue({ c: 3 })
    const result = await checkDatabase()
    expect(result.status).toBe('up')
    expect(typeof result.latency_ms).toBe('number')
  })

  it('reports down (never throws) when the DB query throws', async () => {
    getMock.mockImplementation(() => {
      throw new Error('disk I/O error')
    })
    const result = await checkDatabase()
    expect(result.status).toBe('down')
    expect(result.latency_ms).toBeUndefined()
  })
})
