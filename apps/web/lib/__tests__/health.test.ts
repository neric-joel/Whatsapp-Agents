import { describe, expect, it, vi } from 'vitest'

import { checkDatabase } from '../health'

const selectMock = vi.fn()

vi.mock('../supabase/server', () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({ select: selectMock }),
  }),
}))

// Each test sets its own mock implementation (overwriting the prior one), so no
// beforeEach reset is needed — and a mockReset() followed by a throwing
// mockImplementation hits a vitest v4 quirk that surfaces the caught error.
describe('checkDatabase', () => {
  it('reports up with a latency when the DB query succeeds', async () => {
    selectMock.mockImplementation(async () => ({ error: null, count: 3 }))
    const result = await checkDatabase()
    expect(result.status).toBe('up')
    expect(typeof result.latency_ms).toBe('number')
  })

  it('reports down when the DB query returns an error', async () => {
    selectMock.mockImplementation(async () => ({ error: { message: 'relation does not exist' } }))
    const result = await checkDatabase()
    expect(result.status).toBe('down')
    expect(result.latency_ms).toBeUndefined()
  })

  it('reports down (never throws) when the client/query throws', async () => {
    selectMock.mockImplementation(() => {
      throw new Error('ECONNREFUSED')
    })
    const result = await checkDatabase()
    expect(result.status).toBe('down')
  })
})
