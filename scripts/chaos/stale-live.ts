/**
 * scripts/chaos/stale-live.ts — F4: deterministic live-DB proof of the stale-run
 * recovery guards against real Postgres + PostgREST `.or()` semantics.
 *
 * Proves, by inserting controlled agent_runs rows and invoking the REAL
 * recoverStaleRuns():
 *   (1) a freshly-claimed run (status=running, started_at=now, heartbeat_at=NULL)
 *       is NOT recovered — the age guard prevents the "instant-stale" false positive.
 *   (2) a run whose heartbeat truly stopped (heartbeat_at old) IS recovered.
 *   (3) an old NULL-heartbeat run (started_at old, never heartbeated) IS recovered.
 *   (4) a healthy run with a recent heartbeat is NOT recovered.
 *
 * Service-role only. Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TEST_USER_ID.
 * Cleans up its own rows. Exit 0 = PASS.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { recoverStaleRuns } from '../../bridge/src/lib/stale-runs.js'

const url = req('SUPABASE_URL')
const key = req('SUPABASE_SERVICE_ROLE_KEY')
function req(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}
const sb: SupabaseClient = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const STALE_MS = 60_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

async function setup(): Promise<{ roomId: string; agentId: string; userId: string }> {
  const { data: u } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 })
  const userId = process.env.TEST_USER_ID ?? u?.users?.[0]?.id
  if (!userId) throw new Error('no test user')
  const { data: agent } = await sb
    .from('agents')
    .select('id')
    .eq('is_active', true)
    .limit(1)
    .single()
  const { data: room } = await sb
    .from('rooms')
    .insert({
      name: `Chaos F4 ${new Date().toISOString()}`,
      room_type: 'group',
      created_by_user_id: userId,
    })
    .select('id')
    .single()
  return { roomId: (room as { id: string }).id, agentId: (agent as { id: string }).id, userId }
}

async function insertRun(
  ctx: { roomId: string; agentId: string },
  fields: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await sb
    .from('agent_runs')
    .insert({ room_id: ctx.roomId, agent_id: ctx.agentId, round_index: 0, ...fields })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insert run: ${error?.message}`)
  return (data as { id: string }).id
}

async function statusOf(id: string): Promise<string> {
  const { data } = await sb.from('agent_runs').select('status').eq('id', id).single()
  return (data as { status: string }).status
}

async function main(): Promise<void> {
  const ctx = await setup()
  const cases: { id: string; label: string; expectRecovered: boolean }[] = []

  // (1) fresh claim: running, started now, no heartbeat → must NOT be recovered.
  cases.push({
    id: await insertRun(ctx, {
      status: 'running',
      worker_id: 'w1',
      started_at: iso(0),
      heartbeat_at: null,
    }),
    label: 'fresh NULL-heartbeat running run (just claimed)',
    expectRecovered: false,
  })
  // (2) heartbeat stopped long ago → must be recovered.
  cases.push({
    id: await insertRun(ctx, {
      status: 'running',
      worker_id: 'w-dead',
      started_at: iso(5 * 60_000),
      heartbeat_at: iso(2 * 60_000),
    }),
    label: 'running run with a 2-min-old heartbeat (worker died)',
    expectRecovered: true,
  })
  // (3) old NULL heartbeat (claimed >stale ago, never heartbeated) → recovered.
  cases.push({
    id: await insertRun(ctx, {
      status: 'claimed',
      worker_id: 'w-dead',
      started_at: iso(3 * 60_000),
      heartbeat_at: null,
    }),
    label: 'claimed run, NULL heartbeat, started 3 min ago',
    expectRecovered: true,
  })
  // (4) healthy run, recent heartbeat → NOT recovered.
  cases.push({
    id: await insertRun(ctx, {
      status: 'running',
      worker_id: 'w1',
      started_at: iso(30_000),
      heartbeat_at: iso(2_000),
    }),
    label: 'healthy running run with a 2s-old heartbeat',
    expectRecovered: false,
  })

  const before = Object.fromEntries(
    await Promise.all(cases.map(async (c) => [c.id, await statusOf(c.id)])),
  )

  const recovered = await recoverStaleRuns({
    supabase: sb,
    staleMs: STALE_MS,
    reason: 'stale: F4 live test',
    logRecovered: () => {},
  })

  let pass = true
  for (const c of cases) {
    const after = await statusOf(c.id)
    const wasRecovered = before[c.id] !== 'failed' && after === 'failed'
    const ok = wasRecovered === c.expectRecovered
    pass = pass && ok
    console.log(
      `[F4] ${ok ? 'PASS' : 'FAIL'} — ${c.label}: ${before[c.id]} -> ${after} (recovered=${wasRecovered}, expected=${c.expectRecovered})`,
    )
  }
  console.log(`[F4] recoverStaleRuns reported ${recovered} recovered`)

  // Cleanup our rows + room.
  await sb
    .from('agent_runs')
    .delete()
    .in(
      'id',
      cases.map((c) => c.id),
    )
  await sb.from('rooms').delete().eq('id', ctx.roomId)

  console.log(`\n[chaos F4] VERDICT: ${pass ? 'PASS' : 'FAIL'}`)
  if (!pass) process.exitCode = 1
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
