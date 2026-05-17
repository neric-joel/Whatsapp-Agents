import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recoverStaleRuns } from '../src/lib/stale-runs.js'

test('recoverStaleRuns marks stale claimed and running runs as failed', async () => {
  const updates: Array<{ values: Record<string, unknown>; id: string }> = []
  const staleRows = [{ id: 'run-1' }, { id: 'run-2' }]

  const supabase = {
    from(table: string) {
      assert.equal(table, 'agent_runs')
      return {
        select(fields: string) {
          assert.equal(fields, 'id')
          return {
            in(column: string, statuses: string[]) {
              assert.equal(column, 'status')
              assert.deepEqual(statuses, ['claimed', 'running'])
              return this
            },
            or(filter: string) {
              assert.equal(filter, 'heartbeat_at.is.null,heartbeat_at.lt.2026-05-17T03:40:00.000Z')
              return Promise.resolve({ data: staleRows, error: null })
            },
          }
        },
        update(values: Record<string, unknown>) {
          return {
            eq(column: string, id: string) {
              assert.equal(column, 'id')
              updates.push({ values, id })
              return Promise.resolve({ data: null, error: null })
            },
          }
        },
      }
    },
  }

  const recovered = await recoverStaleRuns({
    supabase,
    staleMs: 60_000,
    now: () => new Date('2026-05-17T03:41:00.000Z').getTime(),
    reason: 'stale: recovered by periodic sweep',
    logRecovered: () => {},
  })

  assert.equal(recovered, 2)
  assert.deepEqual(updates, [
    {
      id: 'run-1',
      values: {
        status: 'failed',
        error_message: 'stale: recovered by periodic sweep',
        completed_at: '2026-05-17T03:41:00.000Z',
      },
    },
    {
      id: 'run-2',
      values: {
        status: 'failed',
        error_message: 'stale: recovered by periodic sweep',
        completed_at: '2026-05-17T03:41:00.000Z',
      },
    },
  ])
})

