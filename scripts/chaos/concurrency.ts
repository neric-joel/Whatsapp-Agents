/**
 * scripts/chaos/concurrency.ts — C1/C3 concurrency invariant harness.
 *
 * Bursts ROOMS x AGENTS queued agent_runs at the live bridge (mock adapter) and,
 * while the bridge drains, samples the in-flight (`claimed`+`running`) count to
 * prove the worker never exceeds BRIDGE_MAX_CONCURRENT_RUNS. After each wave it
 * asserts every run reached a terminal state, no run is orphaned, and exactly one
 * agent message exists per completed run (no realtime/DB duplicate or drop, and no
 * double-claim across workers).
 *
 * Service-role only (test fixture). Reads from env (point at LOCAL):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_USER_ID
 *   SC_ROOMS (6), SC_AGENTS (4), SC_WAVES (3), SC_CAP (3),
 *   SC_TIMEOUT_MS (120000), SC_ROOM_PREFIX ('Chaos C1')
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = required('SUPABASE_URL')
const key = required('SUPABASE_SERVICE_ROLE_KEY')
const TEST_USER_ID = process.env.TEST_USER_ID
const ROOMS = num('SC_ROOMS', 6)
const AGENTS = num('SC_AGENTS', 4)
const WAVES = num('SC_WAVES', 3)
const CAP = num('SC_CAP', 3)
const TIMEOUT_MS = num('SC_TIMEOUT_MS', 120_000)
const PREFIX = process.env.SC_ROOM_PREFIX ?? 'Chaos C1'
const SAMPLE_MS = 60

function required(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}
function num(k: string, d: number): number {
  const v = process.env[k]
  return v ? Number(v) : d
}
const sb: SupabaseClient = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getUserId(): Promise<string> {
  if (TEST_USER_ID) return TEST_USER_ID
  const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 })
  const id = data?.users?.[0]?.id
  if (!id) throw new Error('no auth user; set TEST_USER_ID')
  return id
}

async function activeMockAgents(): Promise<{ id: string; slug: string }[]> {
  const { data, error } = await sb
    .from('agents')
    .select('id, slug')
    .eq('is_active', true)
    .order('slug')
  if (error) throw new Error(error.message)
  const agents = (data ?? []).slice(0, AGENTS)
  if (agents.length < AGENTS)
    throw new Error(`need ${AGENTS} active agents, found ${agents.length}`)
  return agents as { id: string; slug: string }[]
}

async function createRoom(userId: string, name: string): Promise<string> {
  const { data, error } = await sb
    .from('rooms')
    .insert({
      name,
      room_type: 'group',
      reply_mode: 'everyone',
      max_agent_rounds: 1,
      created_by_user_id: userId,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`create room: ${error?.message}`)
  return (data as { id: string }).id
}

async function addAgents(roomId: string, agents: { id: string }[]): Promise<void> {
  const rows = agents.map((a) => ({
    room_id: roomId,
    member_type: 'agent',
    agent_id: a.id,
    role: 'member',
    reply_enabled: true,
    muted: false,
  }))
  const { error } = await sb.from('room_members').upsert(rows, { onConflict: 'room_id,agent_id' })
  if (error) throw new Error(`add agents: ${error.message}`)
}

/** Insert one user message + one queued run per agent in a room. Returns run ids. */
async function burstRoom(
  roomId: string,
  userId: string,
  agents: { id: string }[],
  wave: number,
): Promise<string[]> {
  const { data: msg, error: msgErr } = await sb
    .from('messages')
    .insert({
      room_id: roomId,
      sender_type: 'user',
      sender_user_id: userId,
      content: `chaos C1 wave ${wave} @everyone`,
      content_type: 'text',
      round_index: 0,
    })
    .select('id')
    .single()
  if (msgErr || !msg) throw new Error(`msg: ${msgErr?.message}`)
  const rows = agents.map((a) => ({
    room_id: roomId,
    agent_id: a.id,
    trigger_msg_id: (msg as { id: string }).id,
    status: 'queued',
    round_index: 0,
  }))
  const { data, error } = await sb.from('agent_runs').insert(rows).select('id')
  if (error || !data) throw new Error(`runs: ${error?.message}`)
  return (data as { id: string }[]).map((r) => r.id)
}

async function inFlightCount(runIds: string[]): Promise<number> {
  const { count, error } = await sb
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .in('id', runIds)
    .in('status', ['claimed', 'running'])
  if (error) throw new Error(error.message)
  return count ?? 0
}

type WaveResult = {
  wave: number
  totalRuns: number
  peakInFlight: number
  terminal: number
  byStatus: Record<string, number>
  orphaned: number
  agentMessages: number
  exactlyOneMsgPerCompleted: boolean
  timedOut: boolean
  drainMs: number
}

async function runWave(
  wave: number,
  rooms: { id: string }[],
  userId: string,
  agents: { id: string }[],
): Promise<WaveResult> {
  const t0 = Date.now()
  // Window start (2s buffer for clock skew); waves drain fully + sequentially, so
  // agent messages created since this point belong only to this wave.
  const waveStart = new Date(Date.now() - 2000).toISOString()
  // Burst all rooms near-simultaneously.
  const idLists = await Promise.all(rooms.map((r) => burstRoom(r.id, userId, agents, wave)))
  const runIds = idLists.flat()

  // Sample in-flight while draining.
  let peak = 0
  let timedOut = false
  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    const [inflight, term] = await Promise.all([
      inFlightCount(runIds),
      sb
        .from('agent_runs')
        .select('id', { count: 'exact', head: true })
        .in('id', runIds)
        .in('status', ['completed', 'failed', 'cancelled']),
    ])
    peak = Math.max(peak, inflight)
    const terminal = term.count ?? 0
    if (terminal >= runIds.length) break
    if (Date.now() > deadline) {
      timedOut = true
      break
    }
    await delay(SAMPLE_MS)
  }

  // Final tally.
  const { data: finalRuns } = await sb
    .from('agent_runs')
    .select('id, status, agent_id, room_id, trigger_msg_id')
    .in('id', runIds)
  const byStatus: Record<string, number> = {}
  for (const r of finalRuns ?? []) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
  const orphaned = (finalRuns ?? []).filter(
    (r) => r.status === 'claimed' || r.status === 'running',
  ).length
  const terminal = (finalRuns ?? []).filter((r) =>
    ['completed', 'failed', 'cancelled'].includes(r.status),
  ).length
  const completed = (finalRuns ?? []).filter((r) => r.status === 'completed')

  // Exactly one agent message per completed run (no dup/drop, no double-claim).
  // The bridge writes exactly one agent message per completed run but does not tag it
  // with trigger_msg_id, so we count agent messages created in this wave's window and
  // require it to equal the number of completed runs (1:1). A double-claim or dup
  // insert => more messages than completed runs; a drop => fewer.
  const roomIds = [...new Set(rooms.map((r) => r.id))]
  const { data: agentMsgs } = await sb
    .from('messages')
    .select('id, sender_agent_id, room_id, created_at')
    .in('room_id', roomIds)
    .eq('sender_type', 'agent')
    .gte('created_at', waveStart)
  const msgs = agentMsgs ?? []
  // Informational only: with reused rooms + back-to-back waves the per-wave time
  // window bleeds across waves, so this is NOT a pass criterion. The authoritative
  // no-dup/no-drop check is the GLOBAL 1:1 assertion in main().
  const exactlyOne = msgs.length === completed.length

  return {
    wave,
    totalRuns: runIds.length,
    peakInFlight: peak,
    terminal,
    byStatus,
    orphaned,
    agentMessages: msgs.length,
    exactlyOneMsgPerCompleted: exactlyOne,
    timedOut,
    drainMs: Date.now() - t0,
  }
}

async function main(): Promise<void> {
  const userId = await getUserId()
  const agents = await activeMockAgents()
  console.log(
    `[chaos C1] rooms=${ROOMS} agents=${AGENTS} waves=${WAVES} cap=${CAP} runs/wave=${ROOMS * AGENTS}`,
  )
  const stamp = new Date().toISOString()
  const rooms: { id: string }[] = []
  for (let i = 0; i < ROOMS; i++) {
    const id = await createRoom(userId, `${PREFIX} ${stamp} #${i}`)
    await addAgents(id, agents)
    rooms.push({ id })
  }

  const results: WaveResult[] = []
  let pass = true
  for (let w = 1; w <= WAVES; w++) {
    const res = await runWave(w, rooms, userId, agents)
    results.push(res)
    // Per-wave pass criteria: cap never exceeded, all tracked runs terminal, none
    // orphaned, no timeout. (The per-wave message count is informational only — with
    // reused rooms + back-to-back waves the time window bleeds across waves; the
    // authoritative no-dup/no-drop check is the GLOBAL 1:1 assertion below.)
    const capOk = res.peakInFlight <= CAP
    const drained = res.terminal === res.totalRuns && res.orphaned === 0 && !res.timedOut
    const ok = capOk && drained
    pass = pass && ok
    console.log(
      `[wave ${w}] runs=${res.totalRuns} peakInFlight=${res.peakInFlight} (cap ${CAP} ${capOk ? 'OK' : 'EXCEEDED'}) ` +
        `terminal=${res.terminal} orphaned=${res.orphaned} status=${JSON.stringify(res.byStatus)} ` +
        `timedOut=${res.timedOut} drainMs=${res.drainMs} => ${ok ? 'PASS' : 'FAIL'}`,
    )
  }

  // GLOBAL invariant: exactly one agent message per completed run across the whole
  // run (no realtime/DB duplicate, no drop, no double-claim across workers).
  const roomIds = rooms.map((r) => r.id)
  const { count: totalAgentMsgs } = await sb
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('room_id', roomIds)
    .eq('sender_type', 'agent')
  const { count: totalCompleted } = await sb
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .in('room_id', roomIds)
    .eq('status', 'completed')
  const oneToOne = (totalAgentMsgs ?? -1) === (totalCompleted ?? -2)
  pass = pass && oneToOne
  console.log(
    `[global] completed_runs=${totalCompleted} agent_messages=${totalAgentMsgs} ` +
      `oneMsgPerCompletedRun=${oneToOne ? 'YES' : 'NO'}`,
  )

  console.log(`\n[chaos C1] VERDICT: ${pass ? 'PASS' : 'FAIL'}`)
  console.log(
    JSON.stringify({ cap: CAP, oneToOne, totalCompleted, totalAgentMsgs, results }, null, 2),
  )
  if (!pass) process.exitCode = 1
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
