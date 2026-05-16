import path from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const ROOM_NAME = 'Stress Test Room'
const DEFAULT_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 2_000

export type Problem = {
  cat: 'MATH' | 'SCIENCE' | 'PHILOSOPHY'
  level: 'EASY' | 'MEDIUM' | 'HARD' | 'EXTRA_HARD'
  q: string
}

type Agent = {
  id: string
  name: string
  slug: string
}

type Room = {
  id: string
  name: string
}

type MessageRow = {
  id: string
  content: string
  created_at: string
  sender_agent_id: string | null
  metadata: Record<string, unknown> | null
}

type AgentRunRow = {
  id: string
  agent_id: string
  status: string
  round_index: number
  created_at: string
}

export type AgentRunResult = {
  agentId: string
  agentName: string
  status: 'completed' | 'failed' | 'timed_out'
  runCount: number
  completedRunCount: number
  failedRunCount: number
  timedOutRunCount: number
  roundsCompleted: number
  hallucinationFlagged: boolean
  replyPreview: string | null
}

export const PROBLEMS: Problem[] = [
  { cat: 'MATH', level: 'EASY', q: 'What is 15% of 240?' },
  { cat: 'MATH', level: 'MEDIUM', q: 'Solve: integral of x^2 * e^x dx' },
  { cat: 'MATH', level: 'HARD', q: 'Prove that the square root of 2 is irrational.' },
  { cat: 'MATH', level: 'EXTRA_HARD', q: 'Prove or disprove: every even integer greater than 2 can be expressed as the sum of two primes.' },
  { cat: 'SCIENCE', level: 'EASY', q: 'Why is the sky blue?' },
  { cat: 'SCIENCE', level: 'MEDIUM', q: 'Explain how CRISPR-Cas9 gene editing works at the molecular level.' },
  { cat: 'SCIENCE', level: 'HARD', q: 'Derive the Schwarzschild radius from general relativity.' },
  { cat: 'SCIENCE', level: 'EXTRA_HARD', q: 'Propose a testable hypothesis for why the cosmological constant is 120 orders of magnitude smaller than quantum field theory predicts.' },
  { cat: 'PHILOSOPHY', level: 'EASY', q: 'What is the trolley problem and what are the main ethical positions?' },
  { cat: 'PHILOSOPHY', level: 'MEDIUM', q: "Steelman and steelman-attack Descartes' 'I think therefore I am'." },
  { cat: 'PHILOSOPHY', level: 'HARD', q: 'Is mathematics invented or discovered? Argue both sides then pick one.' },
  { cat: 'PHILOSOPHY', level: 'EXTRA_HARD', q: 'Can a purely materialist worldview account for the existence of consciousness? Develop a novel argument.' },
]

export function summarizeProblemResults(results: AgentRunResult[]) {
  return {
    totalRuns: results.reduce((total, result) => total + result.runCount, 0),
    completed: results.reduce((total, result) => total + result.completedRunCount, 0),
    failed: results.reduce((total, result) => total + result.failedRunCount, 0),
    timedOut: results.reduce((total, result) => total + result.timedOutRunCount, 0),
    hallucinationFlags: results.filter((result) => result.hallucinationFlagged).length,
    totalRounds: results.reduce((total, result) => total + result.roundsCompleted, 0),
  }
}

export function formatProblemReport(problem: Problem, results: AgentRunResult[]): string {
  const lines = [`[${problem.cat} - ${problem.level}] ${problem.q}`]

  for (const result of results) {
    const roundLabel = result.roundsCompleted === 1 ? 'round' : 'rounds'
    lines.push(
      `  ${result.agentName}: ${result.status} | ${result.roundsCompleted} ${roundLabel} | hallucination: ${result.hallucinationFlagged}`,
    )
  }

  const preview = results.find((result) => result.replyPreview)?.replyPreview
  if (preview) {
    lines.push(`  Reply preview: "${preview}"`)
  }

  return lines.join('\n')
}

function formatSummary(totalMessages: number, allResults: AgentRunResult[]): string {
  const summary = summarizeProblemResults(allResults)
  const avgRoundsPerQuestion = totalMessages === 0 ? 0 : summary.totalRounds / totalMessages

  return [
    '=== Summary ===',
    `Total messages: ${totalMessages}`,
    `Total runs: ${summary.totalRuns}`,
    `Completed: ${summary.completed} | Failed: ${summary.failed} | Timed out: ${summary.timedOut}`,
    `Hallucination flags: ${summary.hallucinationFlags}`,
    `Avg rounds per question: ${avgRoundsPerQuestion.toFixed(2)}`,
  ].join('\n')
}

function createServiceClientFromBridgeEnv(): SupabaseClient {
  const repoRoot = process.cwd()
  const envPath = path.join(repoRoot, 'bridge', '.env')
  const result = loadDotenv({ path: envPath })

  if (result.error) {
    throw new Error(`Failed to load ${envPath}: ${result.error.message}`)
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('bridge/.env must define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function findOrCreateRoom(supabase: SupabaseClient, testUserId: string): Promise<Room> {
  const { data: existingRoom, error: findError } = await supabase
    .from('rooms')
    .select('id, name')
    .eq('name', ROOM_NAME)
    .limit(1)
    .maybeSingle()

  if (findError) throw new Error(`Failed to find stress test room: ${findError.message}`)
  if (existingRoom) return existingRoom as Room

  const { data: insertedRoom, error: insertError } = await supabase
    .from('rooms')
    .insert({
      name: ROOM_NAME,
      room_type: 'group',
      reply_mode: 'everyone',
      max_agent_rounds: 3,
      created_by_user_id: testUserId,
    })
    .select('id, name')
    .single()

  if (insertError || !insertedRoom) {
    throw new Error(`Failed to create stress test room: ${insertError?.message ?? 'no row returned'}`)
  }

  return insertedRoom as Room
}

async function getActiveAgents(supabase: SupabaseClient): Promise<Agent[]> {
  const { data, error } = await supabase
    .from('agents')
    .select('id, name, slug')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw new Error(`Failed to fetch active agents: ${error.message}`)

  const agents = (data ?? []) as Agent[]
  if (agents.length === 0) throw new Error('No active agents found')

  return agents
}

async function ensureAgentRoomMembers(supabase: SupabaseClient, roomId: string, agents: Agent[]): Promise<void> {
  const rows = agents.map((agent) => ({
    room_id: roomId,
    member_type: 'agent',
    agent_id: agent.id,
    role: 'member',
    reply_enabled: true,
    muted: false,
  }))

  const { error } = await supabase
    .from('room_members')
    .upsert(rows, { onConflict: 'room_id,agent_id' })

  if (error) throw new Error(`Failed to add active agents to room: ${error.message}`)
}

async function findTestUserId(supabase: SupabaseClient): Promise<string> {
  if (process.env.TEST_USER_ID) return process.env.TEST_USER_ID

  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
  if (error) throw new Error(`Failed to fetch auth.users: ${error.message}`)

  const firstUser = data.users[0]
  if (!firstUser) throw new Error('No auth.users rows found; set TEST_USER_ID in bridge/.env or environment')

  return firstUser.id
}

async function insertUserMessage(
  supabase: SupabaseClient,
  roomId: string,
  testUserId: string,
  problem: Problem,
  problemIndex: number,
  stressRunId: string,
): Promise<MessageRow> {
  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      room_id: roomId,
      sender_type: 'user',
      sender_user_id: testUserId,
      content: problem.q,
      content_type: 'text',
      round_index: 0,
      metadata: {
        stress_test: {
          run_id: stressRunId,
          problem_index: problemIndex,
          category: problem.cat,
          level: problem.level,
        },
      },
    })
    .select('id, content, created_at, sender_agent_id, metadata')
    .single()

  if (error || !message) {
    throw new Error(`Failed to insert user message: ${error?.message ?? 'no row returned'}`)
  }

  await supabase
    .from('rooms')
    .update({ last_message_at: (message as MessageRow).created_at })
    .eq('id', roomId)

  return message as MessageRow
}

async function insertInitialAgentRuns(
  supabase: SupabaseClient,
  roomId: string,
  messageId: string,
  agents: Agent[],
): Promise<AgentRunRow[]> {
  const rows = agents.map((agent) => ({
    room_id: roomId,
    agent_id: agent.id,
    trigger_msg_id: messageId,
    status: 'queued',
    round_index: 0,
  }))

  const { data, error } = await supabase
    .from('agent_runs')
    .insert(rows)
    .select('id, agent_id, status, round_index, created_at')

  if (error || !data) {
    throw new Error(`Failed to insert agent runs: ${error?.message ?? 'no rows returned'}`)
  }

  return data as AgentRunRow[]
}

async function fetchRunsSince(
  supabase: SupabaseClient,
  roomId: string,
  createdAt: string,
): Promise<AgentRunRow[]> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('id, agent_id, status, round_index, created_at')
    .eq('room_id', roomId)
    .gte('created_at', createdAt)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to poll agent runs: ${error.message}`)

  return (data ?? []) as AgentRunRow[]
}

async function fetchAgentMessagesSince(
  supabase: SupabaseClient,
  roomId: string,
  createdAt: string,
): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, content, created_at, sender_agent_id, metadata')
    .eq('room_id', roomId)
    .eq('sender_type', 'agent')
    .gte('created_at', createdAt)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to fetch agent replies: ${error.message}`)

  return (data ?? []) as MessageRow[]
}

async function waitForRuns(
  supabase: SupabaseClient,
  roomId: string,
  messageCreatedAt: string,
  initialRunIds: string[],
  timeoutMs: number,
): Promise<{ timedOut: boolean; runs: AgentRunRow[] }> {
  const deadline = Date.now() + timeoutMs
  let latestRuns: AgentRunRow[] = []
  const initialRunIdSet = new Set(initialRunIds)

  while (Date.now() < deadline) {
    latestRuns = await fetchRunsSince(supabase, roomId, messageCreatedAt)
    const sawInitialRuns = initialRunIds.every((runId) => latestRuns.some((run) => run.id === runId))
    const allTerminal = latestRuns.length > 0 && latestRuns.every((run) => isTerminalStatus(run.status))

    if (sawInitialRuns && allTerminal) {
      return { timedOut: false, runs: latestRuns }
    }

    const missingInitialRuns = latestRuns.filter((run) => initialRunIdSet.has(run.id)).length < initialRunIds.length
    if (missingInitialRuns && latestRuns.length > 0) {
      throw new Error('Polling query did not return all initially inserted agent runs')
    }

    await delay(POLL_INTERVAL_MS)
  }

  latestRuns = await fetchRunsSince(supabase, roomId, messageCreatedAt)
  return { timedOut: true, runs: latestRuns }
}

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function collectAgentResults(
  agents: Agent[],
  runs: AgentRunRow[],
  messages: MessageRow[],
  timedOut: boolean,
): AgentRunResult[] {
  return agents.map((agent) => {
    const agentRuns = runs.filter((run) => run.agent_id === agent.id)
    const agentMessages = messages.filter((message) => message.sender_agent_id === agent.id)
    const hasNonTerminalRun = agentRuns.some((run) => !isTerminalStatus(run.status))
    const hasFailedRun = agentRuns.some((run) => run.status === 'failed' || run.status === 'cancelled')
    const completedRuns = agentRuns.filter((run) => run.status === 'completed')
    const failedRuns = agentRuns.filter((run) => run.status === 'failed' || run.status === 'cancelled')
    const timedOutRuns = timedOut ? agentRuns.filter((run) => !isTerminalStatus(run.status)) : []
    const status = agentRuns.length === 0 || (timedOut && hasNonTerminalRun)
      ? 'timed_out'
      : hasFailedRun
        ? 'failed'
        : 'completed'

    return {
      agentId: agent.id,
      agentName: agent.name,
      status,
      runCount: agentRuns.length,
      completedRunCount: completedRuns.length,
      failedRunCount: failedRuns.length,
      timedOutRunCount: timedOutRuns.length,
      roundsCompleted: completedRuns.length,
      hallucinationFlagged: agentMessages.some((message) => isHallucinationFlagged(message.metadata)),
      replyPreview: toReplyPreview(agentMessages[0]?.content),
    }
  })
}

function isHallucinationFlagged(metadata: Record<string, unknown> | null): boolean {
  const hallucination = metadata?.hallucination
  if (!hallucination || typeof hallucination !== 'object') return false

  return (hallucination as { flagged?: unknown }).flagged === true
}

function toReplyPreview(content: string | undefined): string | null {
  if (!content) return null

  const preview = content.replace(/\s+/g, ' ').trim().slice(0, 200)
  return preview.length > 0 ? preview : null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseTimeoutMs(): number {
  const raw = process.env.STRESS_TEST_TIMEOUT_MS
  if (!raw) return DEFAULT_TIMEOUT_MS

  const timeoutMs = Number(raw)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('STRESS_TEST_TIMEOUT_MS must be a positive number')
  }

  return timeoutMs
}

async function main(): Promise<void> {
  const supabase = createServiceClientFromBridgeEnv()
  const timeoutMs = parseTimeoutMs()
  const stressRunId = crypto.randomUUID()
  const testUserId = await findTestUserId(supabase)
  const room = await findOrCreateRoom(supabase, testUserId)
  const agents = await getActiveAgents(supabase)
  await ensureAgentRoomMembers(supabase, room.id, agents)

  const allResults: AgentRunResult[] = []

  console.log('=== AgentRoom Stress Test Report ===')
  console.log(`Room: ${room.name} (${room.id})`)
  console.log(`Agents: [${agents.map((agent) => agent.name).join(', ')}]`)
  console.log(`Timeout per message: ${Math.round(timeoutMs / 1000)}s`)
  console.log('')

  for (const [problemIndex, problem] of PROBLEMS.entries()) {
    const message = await insertUserMessage(supabase, room.id, testUserId, problem, problemIndex, stressRunId)
    const initialRuns = await insertInitialAgentRuns(supabase, room.id, message.id, agents)
    const waitResult = await waitForRuns(
      supabase,
      room.id,
      message.created_at,
      initialRuns.map((run) => run.id),
      timeoutMs,
    )
    const agentMessages = await fetchAgentMessagesSince(supabase, room.id, message.created_at)
    const problemResults = collectAgentResults(agents, waitResult.runs, agentMessages, waitResult.timedOut)

    allResults.push(...problemResults)

    console.log(formatProblemReport(problem, problemResults))
    console.log('')
  }

  console.log(formatSummary(PROBLEMS.length, allResults))
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
