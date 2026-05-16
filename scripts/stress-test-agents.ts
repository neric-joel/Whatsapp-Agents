import path from 'node:path'
import { config as loadDotenv } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const ROOM_NAME = 'Stress Test Room'
const DEFAULT_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 2_000

export type Problem = {
  cat: 'CODING' | 'PHYSICS' | 'MATH' | 'PHILOSOPHY' | 'LIFE'
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
  { cat: 'CODING', level: 'EASY', q: 'Write a Python function to check if a given string is a palindrome.' },
  { cat: 'CODING', level: 'MEDIUM', q: 'Implement a thread-safe LRU (Least Recently Used) Cache in C++ or Rust.' },
  { cat: 'CODING', level: 'HARD', q: 'Design the architecture and write the core consensus logic for a distributed, fault-tolerant key-value store using the Raft algorithm. Handle network partitions.' },
  { cat: 'CODING', level: 'EXTRA_HARD', q: 'Write a custom compiler frontend in C that takes a novel, Turing-complete functional programming language and compiles it down to optimized LLVM IR. Include custom garbage collection logic.' },
  { cat: 'PHYSICS', level: 'EASY', q: 'A car accelerates from 0 to 60 mph in 5 seconds. What is its average acceleration in meters per second squared?' },
  { cat: 'PHYSICS', level: 'MEDIUM', q: 'Calculate the trajectory of a projectile launched at 45 degrees, accounting for quadratic air resistance (drag) and varying air density with altitude.' },
  { cat: 'PHYSICS', level: 'HARD', q: 'Derive the Hawking radiation temperature for a Kerr (rotating) black hole, explaining the role of the ergosphere.' },
  { cat: 'PHYSICS', level: 'EXTRA_HARD', q: 'Reconcile the Black Hole Information Paradox by synthesizing the Holographic Principle and the Firewall Paradox. Provide a mathematical justification for how unitarity is preserved.' },
  { cat: 'MATH', level: 'EASY', q: 'Solve for x: 3x + 7 = 22.' },
  { cat: 'MATH', level: 'MEDIUM', q: 'Provide a rigorous mathematical proof that the square root of 2 is irrational.' },
  { cat: 'MATH', level: 'HARD', q: "Find the general solution to the non-linear differential equation: y'' - y' + y^3 = 0." },
  { cat: 'MATH', level: 'EXTRA_HARD', q: 'Propose a novel heuristic or topological framework that could create a new pathway toward proving or disproving the Riemann Hypothesis. Evaluate the immediate failure points of your proposed framework.' },
  { cat: 'PHILOSOPHY', level: 'EASY', q: 'Explain the core difference between "right" and "wrong" in Utilitarianism.' },
  { cat: 'PHILOSOPHY', level: 'MEDIUM', q: "Apply Kant's Categorical Imperative to the modern dilemma of utilizing AI-generated art for commercial profit." },
  { cat: 'PHILOSOPHY', level: 'HARD', q: 'Deconstruct Martin Heidegger\'s concept of Dasein. Can an Artificial General Intelligence (AGI) possess Dasein? Why or why not?' },
  { cat: 'PHILOSOPHY', level: 'EXTRA_HARD', q: 'Resolve the "Hard Problem of Consciousness" by synthesizing Panpsychism with Quantum Information Theory. Do not rely on mystical concepts; ground the argument in formal epistemology and ontology.' },
  { cat: 'LIFE', level: 'EASY', q: 'What is the most efficient way to organize a weekly grocery shopping trip for a family of four?' },
  { cat: 'LIFE', level: 'MEDIUM', q: 'How should a mid-level manager handle a situation where their two best-performing employees absolutely despise working with each other?' },
  { cat: 'LIFE', level: 'HARD', q: 'Design a comprehensive, multi-year psychological and financial recovery plan for a family that has just lost their home and business to a natural disaster, assuming no government aid.' },
  { cat: 'LIFE', level: 'EXTRA_HARD', q: 'Design the societal, political, and psychological framework for a "Generation Ship" traveling for 500 years to a new star system. The framework must guarantee the prevention of civil war, genetic stagnation, and loss of ultimate purpose over 20 generations of humans who will live and die entirely in transit.' },
]

export function buildEvaluationPrompt(problem: Problem): string {
  return [
    `Evaluation test: ${problem.cat} / ${problem.level}`,
    '',
    `Problem: ${problem.q}`,
    '',
    'Follow this strict 3-phase protocol:',
    '',
    'Phase 1: Individual Assessment (Divergent Thinking)',
    'Provide your own independent analysis and proposed solution. Do not summarize other agents.',
    '',
    'Phase 2: Team Discussion (Critique & Synthesis)',
    'After individual answers are visible, debate flaws, edge cases, and the correct level of abstraction.',
    '',
    'Phase 3: Consensus & Conclusion (Convergent Thinking)',
    'Contribute to a single final response that is clear, accurate, and represents the best synthesized answer.',
  ].join('\n')
}

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

  return filterAgentsForStress(agents, process.env.STRESS_AGENT_SLUGS)
}

export function filterAgentsForStress(agents: Agent[], rawSlugs: string | undefined): Agent[] {
  if (!rawSlugs) return agents

  const allowedSlugs = new Set(rawSlugs.split(',').map((slug) => slug.trim()).filter(Boolean))
  if (allowedSlugs.size === 0) return agents

  const filteredAgents = agents.filter((agent) => allowedSlugs.has(agent.slug))
  if (filteredAgents.length === 0) {
    throw new Error(`No active agents matched STRESS_AGENT_SLUGS=${rawSlugs}`)
  }

  return filteredAgents
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
      content: buildEvaluationPrompt(problem),
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
