// ADR-0011 — team-collaboration /discuss (plan→execute→integrate→[dissent]→converge) and the
// adversarial /debate sibling (assign→argue→rebut→adjudicate). Pure, dependency-free logic so it
// is unit-testable without a DB and shared verbatim by the web kickoff + the bridge orchestrator.

export type DiscussCommand = 'discuss' | 'debate'

export type DiscussionPhase =
  // discuss
  | 'plan'
  | 'execute'
  | 'integrate'
  | 'dissent'
  | 'converge'
  // debate
  | 'assign'
  | 'argue'
  | 'rebut'
  | 'adjudicate'
  // legacy (pre-ADR-0011) — accepted for back-compat, never emitted for new discussions
  | 'individual'
  | 'critique'
  | 'consensus'

/** Compile-time termination backstops (no per-room column — see ADR-0011). */
export const DISCUSSION_MAX_PHASES = 5
export const ABS_MAX_DISCUSSION_ROUNDS = 6
export const COLLAB_MAX_AGENTS = 3

/** Phases that run on a single coordinator agent; everything else fans to all active agents. */
const COORDINATOR_PHASES = new Set<DiscussionPhase>(['plan', 'assign', 'converge', 'adjudicate'])

export type StageTarget = 'coordinator' | 'all'

export function stageTarget(phase: DiscussionPhase): StageTarget {
  return COORDINATOR_PHASES.has(phase) ? 'coordinator' : 'all'
}

export interface NextStage {
  phase: DiscussionPhase
  target: StageTarget
}

/**
 * The phase DAG. Monotonic (no back-edges) → always terminates. `dissent` is inserted ONLY for
 * /discuss when integrate produced no substantive challenge (anti-sycophancy). /debate never
 * inserts dissent (opposing positions guarantee challenge). Returns null at the terminal phase.
 * Legacy phases map onto the nearest new edge so an in-flight pre-upgrade discussion still drains.
 */
export function nextDiscussionStage(
  command: DiscussCommand,
  phase: DiscussionPhase,
  threadHasChallenge: boolean,
): NextStage | null {
  const mk = (p: DiscussionPhase): NextStage => ({ phase: p, target: stageTarget(p) })

  if (command === 'debate') {
    switch (phase) {
      case 'assign':
      case 'plan':
      case 'individual':
        return mk('argue')
      case 'argue':
      case 'execute':
        return mk('rebut')
      case 'rebut':
      case 'integrate':
      case 'critique':
        return mk('adjudicate')
      default:
        return null // adjudicate / converge / consensus → terminal
    }
  }

  // discuss
  switch (phase) {
    case 'plan':
    case 'individual':
      return mk('execute')
    case 'execute':
      return mk('integrate')
    case 'integrate':
    case 'critique':
      return threadHasChallenge ? mk('converge') : mk('dissent')
    case 'dissent':
      return mk('converge')
    default:
      return null // converge / consensus → terminal
  }
}

/**
 * Deterministically pick the coordinator (planner + final composer). Stable so retries are
 * idempotent: a codex-capable agent first (strong at structured plans), else the agent with the
 * richest declared capabilities, else the first. Returns the INDEX so callers map to their row type.
 */
export function selectCoordinatorIndex(
  agents: Array<{ slug: string; provider: string; capabilities?: string | null }>,
): number {
  if (agents.length === 0) return -1
  const codex = agents.findIndex(
    (a) => a.slug.toLowerCase().includes('codex') || a.provider === 'codex_cli',
  )
  if (codex !== -1) return codex
  let best = 0
  let bestLen = (agents[0]?.capabilities ?? '').length
  for (let i = 1; i < agents.length; i++) {
    const len = (agents[i]?.capabilities ?? '').length
    if (len > bestLen) {
      best = i
      bestLen = len
    }
  }
  return best
}

/**
 * Anti-sycophancy gate. A reply counts as a substantive challenge when it voices a
 * disagreement/risk/gap cue AND either names a peer (@slug) or proposes a concrete change —
 * i.e. it is not a rubber-stamp. Conservative: prose that merely agrees never counts.
 */
export function detectChallenge(content: string): boolean {
  const c = content.toLowerCase()
  const challengeCue =
    /\b(i disagree|disagree with|this is (wrong|incorrect|flawed)|doesn'?t (account|handle|work)|misses?|missing|overlooks?|counter(example|point|argument)|risk|weakness|weakest|problem with|concern|gap|edge case|flaw)\b/.test(
      c,
    )
  if (!challengeCue) return false
  const refsPeer = /@[a-z0-9_-]+/i.test(content)
  const proposesChange =
    /\b(instead|should|propose|suggest|recommend|better to|we need|needs? to|fix|change|add|replace|reconsider)\b/.test(
      c,
    )
  return refsPeer || proposesChange
}

export interface Assignment {
  agent_slug: string
  agent_id: string
  task: string
  position?: 'for' | 'against' | 'alternative'
}

export interface CrossReviewPair {
  reviewer_slug: string
  reviewee_slug: string
}

/**
 * Parse the coordinator's plan reply into per-agent assignments. Tolerant: accepts a fenced
 * ```json array, or freeform lines like "@slug: task" / "1. @slug - task". Validates each @slug
 * against the live roster (maps slug→id), dedupes, caps task length. Unknown slugs are dropped.
 * Returns [] when nothing parses → caller applies a deterministic fallback (never stalls).
 */
export function parseTaskList(
  content: string,
  roster: Array<{ slug: string; id: string }>,
): Assignment[] {
  const bySlug = new Map(roster.map((r) => [r.slug.toLowerCase(), r.id]))
  const out: Assignment[] = []
  const seen = new Set<string>()

  const push = (slugRaw: string, task: string, position?: Assignment['position']) => {
    const slug = slugRaw.toLowerCase().replace(/^@/, '')
    const id = bySlug.get(slug)
    if (!id || seen.has(slug) || !task.trim()) return
    seen.add(slug)
    out.push({ agent_slug: slug, agent_id: id, task: task.trim().slice(0, 400), ...(position ? { position } : {}) })
  }

  // 1) fenced JSON array of {agent_slug|slug, task, position?}
  const fence = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/i)
  if (fence?.[1]) {
    try {
      const arr = JSON.parse(fence[1]) as Array<Record<string, unknown>>
      if (Array.isArray(arr)) {
        for (const it of arr) {
          const slug = String(it.agent_slug ?? it.slug ?? it.agent ?? '')
          const task = String(it.task ?? it.subtask ?? it.description ?? '')
          const pos = it.position
          push(slug, task, pos === 'for' || pos === 'against' || pos === 'alternative' ? pos : undefined)
        }
      }
    } catch {
      // fall through to line parsing
    }
  }

  // 2) freeform lines "@slug: task" / "@slug - task"
  if (out.length === 0) {
    const lineRe = /@([a-z0-9_-]+)\s*[:\-–]\s*(.+)$/i
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(lineRe)
      if (m?.[1] && m[2]) push(m[1], m[2])
    }
  }

  return out
}

/** Round-robin cross-review: each agent reviews the next; with n≥2 everyone reviews and is reviewed once. */
export function buildCrossReviewPairs(slugs: string[]): CrossReviewPair[] {
  const uniq = [...new Set(slugs)]
  if (uniq.length < 2) return []
  return uniq.map((reviewer_slug, i) => ({
    reviewer_slug,
    reviewee_slug: uniq[(i + 1) % uniq.length] as string,
  }))
}

/** Render the blackboard (assignments) as DATA for inclusion in a phase prompt. */
export function formatBlackboard(assignments: Assignment[]): string {
  if (assignments.length === 0) return '(no explicit assignments — work the part that fits your capability)'
  return assignments
    .map((a) => `- @${a.agent_slug}${a.position ? ` [${a.position}]` : ''}: ${a.task}`)
    .join('\n')
}

export interface StagePromptOpts {
  blackboard?: string
  reviewee?: string
  attributionHeader?: string
}

/**
 * Build the system prompt for a discussion/debate phase. The result is the trigger-message
 * content for that phase's run(s); each agent self-selects its assigned sub-task by its own @slug.
 * Distinct per (command, phase) so /discuss (collaborative synthesis) and /debate (adversarial
 * adjudication) are genuinely different behaviors, not a cosmetic label.
 */
export function buildDiscussionStagePrompt(
  command: DiscussCommand,
  phase: DiscussionPhase,
  originalPrompt: string,
  opts: StagePromptOpts = {},
): string {
  const head = (title: string, body: string) =>
    [title, '', 'Original problem:', originalPrompt, '', body].join('\n')
  const bb = opts.blackboard ? `\n\nTeam plan (shared blackboard):\n${opts.blackboard}` : ''

  if (command === 'debate') {
    switch (phase) {
      case 'assign':
      case 'plan':
        return head(
          'Debate — phase 1: assign positions (you are the coordinator).',
          'Using the other agents in this room (see the roster + their capabilities), assign each agent ONE DISTINCT position to argue (for / against / a strong alternative). Write one line per agent as "@slug [for|against|alternative]: the position they must defend". Assign yourself a position too. Do not argue yet — only assign.',
        )
      case 'argue':
        return head(
          'Debate — phase 2: argue your assigned position.' + bb,
          'Find the position assigned to YOU (@your-slug) above and make the strongest possible case for it. Be concrete and committed — do NOT hedge or concede. Cite evidence/reasoning. This is adversarial: you are not trying to agree.',
        )
      case 'rebut':
        return head(
          'Debate — phase 3: rebut a rival.' + bb,
          "Attack the strongest point of a RIVAL agent's position (name them by @slug) and defend yours against their best counter-argument. Stay in your assigned position.",
        )
      case 'adjudicate':
        return head(
          'Debate — phase 4: adjudicate (you are the coordinator).' + bb,
          'Weigh the arguments and REBUTTALS above. Declare the prevailing position with explicit reasons, and record the strongest dissenting position that did NOT prevail. Do NOT merge the positions into a compromise — pick a winner. Attribute each position to its @slug. Do not @mention anyone in a way that starts a new turn.',
        )
      default:
        return head('Debate.', originalPrompt)
    }
  }

  // discuss
  switch (phase) {
    case 'plan':
      return head(
        'Discussion — phase 1: plan & decompose (you are the coordinator).',
        'Using the other agents in this room (see the roster + their capabilities), break this problem into COMPLEMENTARY sub-tasks and assign exactly one to each agent (including yourself), matched to their capability. Write one line per agent as "@slug: the sub-task they own". This task list is the shared blackboard the team will build on — do not solve the whole problem yourself.',
      )
    case 'execute':
      return head(
        'Discussion — phase 2: execute your assigned part.' + bb,
        'Find the sub-task assigned to YOU (@your-slug) in the plan above and do ONLY that part well. You can see your teammates above — build on and reference their posted work by @slug where relevant. Do NOT re-solve the whole problem; trust your teammates to own their parts.',
      )
    case 'integrate':
      return head(
        'Discussion — phase 3: integrate & cross-review.' + bb +
          (opts.reviewee ? `\n\nYou are reviewing @${opts.reviewee}'s contribution.` : ''),
        "Cross-review your assigned teammate's contribution (named above): confirm what is correct, flag at least one concrete gap, mistake, or risk (name them by @slug), and propose how to MERGE their part with yours into the team answer. A genuine challenge is required — do not rubber-stamp.",
      )
    case 'dissent':
      return head(
        'Discussion — phase 3b: dissent (the team agreed too easily).' + bb,
        'No one has substantively challenged the emerging answer. Name the SINGLE weakest point in the team\'s current solution and propose a concrete fix. Reference the responsible part by @slug. Do not rubber-stamp.',
      )
    case 'converge':
      return head(
        'Discussion — phase 4: converge (you are the coordinator).' + bb +
          (opts.attributionHeader ? `\n\n${opts.attributionHeader}` : ''),
        'Compose ONE final team answer from the contributions above. Do NOT introduce new substance that is not on the blackboard. Begin with a short "Contributions:" block attributing who did what by @slug, then give the unified answer and any caveats the team agreed matter. Do not @mention another agent in a way that starts a new turn.',
      )
    default:
      return head('Discussion.', originalPrompt)
  }
}

/** The `metadata.discussion` blackboard carried on every discussion message. */
export interface DiscussionMetadata {
  enabled: true
  command: DiscussCommand
  phase: DiscussionPhase
  original_message_id: string
  original_prompt: string
  coordinator_agent_id?: string
  assignments?: Assignment[]
  cross_review_pairs?: CrossReviewPair[]
  /** Stamped per agent reply: did this reply substantively challenge a peer? */
  challenge?: boolean
  /** Audit flag set on converge when the team never produced a challenge even after dissent. */
  anti_sycophancy?: string
}

const ALL_PHASES = new Set<DiscussionPhase>([
  'plan',
  'execute',
  'integrate',
  'dissent',
  'converge',
  'assign',
  'argue',
  'rebut',
  'adjudicate',
  'individual',
  'critique',
  'consensus',
])

/** Validate + read the discussion blackboard from a message's metadata. Null when absent/invalid. */
export function readDiscussionMetadata(
  metadata: Record<string, unknown> | null | undefined,
): DiscussionMetadata | null {
  const d = (metadata as { discussion?: unknown } | null | undefined)?.discussion
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  const v = d as Record<string, unknown>
  if (v.enabled !== true) return null
  if (typeof v.phase !== 'string' || !ALL_PHASES.has(v.phase as DiscussionPhase)) return null
  if (typeof v.original_message_id !== 'string') return null
  if (typeof v.original_prompt !== 'string' || v.original_prompt.trim().length === 0) return null
  return {
    enabled: true,
    command: v.command === 'debate' ? 'debate' : 'discuss',
    phase: v.phase as DiscussionPhase,
    original_message_id: v.original_message_id,
    original_prompt: v.original_prompt,
    ...(typeof v.coordinator_agent_id === 'string'
      ? { coordinator_agent_id: v.coordinator_agent_id }
      : {}),
    ...(Array.isArray(v.assignments) ? { assignments: v.assignments as Assignment[] } : {}),
    ...(Array.isArray(v.cross_review_pairs)
      ? { cross_review_pairs: v.cross_review_pairs as CrossReviewPair[] }
      : {}),
    ...(v.challenge === true ? { challenge: true } : {}),
    ...(typeof v.anti_sycophancy === 'string' ? { anti_sycophancy: v.anti_sycophancy } : {}),
  }
}

/** Map a stage to its 1-based number within its command sequence (for budget/diagnostics). */
export function discussionStageNumber(command: DiscussCommand, phase: DiscussionPhase): number {
  const discuss: DiscussionPhase[] = ['plan', 'execute', 'integrate', 'dissent', 'converge']
  const debate: DiscussionPhase[] = ['assign', 'argue', 'rebut', 'adjudicate']
  const seq = command === 'debate' ? debate : discuss
  const i = seq.indexOf(phase)
  return i === -1 ? 0 : i + 1
}
