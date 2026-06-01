import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recoverStaleRuns } from '../src/lib/stale-runs.js'

type Result = { data: unknown; error: unknown }

/**
 * Fake agent_runs table supporting the recovery query shape:
 *   .select('id').in('status',[...]).or(filter)              → selectResult
 *   .update(v).eq('id',id).in('status',[...]).select('id')   → updateResult(id)
 * Records the `.or()` filter and whether each UPDATE used `.in()` (the status guard).
 */
function makeFake(opts: { selectResult: Result; updateResult?: (id: string) => Result }) {
  const calls = {
    orFilter: '',
    updates: [] as Array<{ id: string; guarded: boolean; values: Record<string, unknown> }>,
  }
  const supabase = {
    from(table: string) {
      assert.equal(table, 'agent_runs')
      return {
        select(_fields: string) {
          return {
            in(_c: string, _s: string[]) {
              return this
            },
            or(filter: string) {
              calls.orFilter = filter
              return Promise.resolve(opts.selectResult)
            },
          }
        },
        update(values: Record<string, unknown>) {
          const chain = { id: '', guarded: false, values }
          const builder: Record<string, unknown> = {
            eq(_c: string, id: string) {
              chain.id = id
              return builder
            },
            in(_c: string, _s: string[]) {
              chain.guarded = true
              return builder
            },
            select(_f: string) {
              calls.updates.push(chain)
              return Promise.resolve(
                opts.updateResult
                  ? opts.updateResult(chain.id)
                  : { data: [{ id: chain.id }], error: null },
              )
            },
          }
          return builder
        },
      }
    },
  }
  return { supabase, calls }
}

test('stale query guards a NULL heartbeat by age (no instant-stale) and the recovery UPDATE is status-guarded', async () => {
  const { supabase, calls } = makeFake({ selectResult: { data: [{ id: 'run-1' }], error: null } })

  const recovered = await recoverStaleRuns({
    supabase,
    staleMs: 60_000,
    now: () => new Date('2026-05-17T03:41:00.000Z').getTime(),
    reason: 'stale: recovered by periodic sweep',
    logRecovered: () => {},
  })

  // A run with a recent (or NULL-but-young) heartbeat must NOT match: NULL only
  // counts when started_at is also older than the cutoff.
  assert.match(calls.orFilter, /heartbeat_at\.lt\.2026-05-17T03:40:00\.000Z/)
  assert.match(
    calls.orFilter,
    /and\(heartbeat_at\.is\.null,started_at\.lt\.2026-05-17T03:40:00\.000Z\)/,
    'NULL heartbeat is age-guarded against started_at',
  )
  assert.equal(recovered, 1)
  assert.equal(
    calls.updates[0]?.guarded,
    true,
    'recovery UPDATE uses .in(status,[claimed,running])',
  )
  assert.equal(calls.updates[0]?.values.status, 'failed')
})

test('status guard: a run that left claimed/running between SELECT and UPDATE is NOT counted recovered', async () => {
  // SELECT returns two candidates; the UPDATE for run-1 affects 0 rows (it
  // completed in the meantime) so it must not be counted or clobbered.
  const { supabase } = makeFake({
    selectResult: { data: [{ id: 'run-1' }, { id: 'run-2' }], error: null },
    updateResult: (id) =>
      id === 'run-1' ? { data: [], error: null } : { data: [{ id }], error: null },
  })

  const recovered = await recoverStaleRuns({
    supabase,
    staleMs: 60_000,
    now: () => new Date('2026-05-17T03:41:00.000Z').getTime(),
    logRecovered: () => {},
  })

  assert.equal(recovered, 1, 'only the run still in claimed/running is recovered')
})
