import { getDb, intBool, jsonText, newId, nowIso } from '@agentroom/db'
import type { AgentEvent } from '@agentroom/shared'
import {
  detectChallenge,
  isDeniedCommand,
  readDiscussionMetadata,
  runCanary,
} from '@agentroom/shared'

import { getAdapter as defaultGetAdapter } from '../adapters/registry.js'
import { handleHandoffRequest } from '../agents/handoff.js'
import { buildContextPacket } from '../context/build-context-packet.js'
import { maybeScheduleAgentMentionFollowUps } from '../lib/agent-follow-up.js'
import { sanitizeAgentOutput } from '../lib/agent-output.js'
import { conclusionDetected } from '../lib/conclusion.js'
import { maybeScheduleDiscussionContinuation } from '../lib/discussion-orchestrator.js'
import { captureError } from '../lib/error-tracking.js'
import { detectHallucination } from '../lib/hallucination.js'
import { log } from '../lib/logger.js'
import {
  recordRunCancelled,
  recordRunCompleted,
  recordRunFailed,
  recordRunStarted,
} from '../lib/metrics.js'
import { redact } from '../lib/redact.js'
import { resolveRuntimeProvider } from '../lib/resolve-runtime-provider.js'
import { persistMemoryOp } from '../memory/persist-memory-op.js'

/** Injectable dependencies — defaults are the real adapter registry. */
interface ProcessRunDeps {
  getAdapter?: typeof defaultGetAdapter
  /** External abort (e.g. bridge shutdown) — linked to this run's cancellation controller. */
  signal?: AbortSignal
  /** Cancellation-watcher poll interval (ms). Lowered in tests to avoid real-time coupling. */
  cancelPollMs?: number
}

type DiscussionMode = 'independent' | 'tag_turns'
type HandoffRequestedEvent = Extract<AgentEvent, { type: 'handoff_requested' }>

const WORKER_ID = process.env.BRIDGE_WORKER_ID ?? 'bridge-local-1'
/** Max distinct hand-offs honored per run — bounds fan-out amplification. */
const MAX_HANDOFFS_PER_RUN = 4
const CANCEL_POLL_MS = 1000

class RunCancelledError extends Error {
  constructor() {
    super('Run was cancelled.')
    this.name = 'RunCancelledError'
  }
}

interface AgentInfo {
  id: string
  name: string
  slug: string
  system_prompt: string | null
  provider: string
  adapter_type: string
  tool_permissions: Record<string, unknown>
  // BYO credential (ADR-0010): the bound credential + the agent's creator (whose
  // credential fuels it). Never carries the secret — only the id + owner.
  credential_id: string | null
  created_by_user_id: string | null
}

interface AgentRunRow {
  id: string
  room_id: string
  agent_id: string
  trigger_msg_id: string | null
  status: string
  round_index: number
  discussion_mode: DiscussionMode
  deliberation_depth: number
  deliberation_root_id: string | null
  agents: AgentInfo | null
}

export async function processRun(runId: string, deps: ProcessRunDeps = {}): Promise<void> {
  const db = getDb()
  const getAdapter = deps.getAdapter ?? defaultGetAdapter
  const startedAt = Date.now()
  // Gates the terminal metrics: only count an outcome for a run we actually moved
  // into `running`. Otherwise a claim/running-transition error or a cancel-in-the-gap
  // would skew the counters (started without terminal, or terminal without started).
  let started = false

  // a. Fetch run with agent data
  const runBase = db
    .prepare(
      'SELECT id, room_id, agent_id, trigger_msg_id, status, round_index, discussion_mode, deliberation_depth, deliberation_root_id FROM agent_runs WHERE id = ?',
    )
    .get(runId) as
    | {
        id: string
        room_id: string
        agent_id: string
        trigger_msg_id: string | null
        status: string
        round_index: number
        discussion_mode: DiscussionMode
        deliberation_depth: number
        deliberation_root_id: string | null
      }
    | undefined

  if (!runBase) return
  const agentRaw = db
    .prepare(
      'SELECT id, name, slug, system_prompt, provider, adapter_type, tool_permissions, credential_id, created_by_user_id FROM agents WHERE id = ?',
    )
    .get(runBase.agent_id) as
    | {
        id: string
        name: string
        slug: string
        system_prompt: string | null
        provider: string
        adapter_type: string
        tool_permissions: string
        credential_id: string | null
        created_by_user_id: string | null
      }
    | undefined
  const runRow: AgentRunRow = {
    ...runBase,
    agents: agentRaw
      ? {
          id: agentRaw.id,
          name: agentRaw.name,
          slug: agentRaw.slug,
          system_prompt: agentRaw.system_prompt,
          provider: agentRaw.provider,
          adapter_type: agentRaw.adapter_type,
          tool_permissions: JSON.parse(agentRaw.tool_permissions || '{}') as Record<
            string,
            unknown
          >,
          credential_id: agentRaw.credential_id,
          created_by_user_id: agentRaw.created_by_user_id,
        }
      : null,
  }

  try {
    // b. Atomically claim
    const claimed = db
      .prepare(
        "UPDATE agent_runs SET status = 'claimed', worker_id = ?, started_at = ? WHERE id = ? AND status = 'queued' RETURNING id",
      )
      .get(WORKER_ID, nowIso(), runId) as { id: string } | undefined

    if (!claimed) {
      log('debug', 'run.skipped', { run_id: runId, reason: 'already_claimed' })
      return
    }
    log('info', 'run.start', { run_id: runId, agent_id: runRow.agent_id, room_id: runRow.room_id })

    // c. Update to running
    const running = db
      .prepare(
        "UPDATE agent_runs SET status = 'running' WHERE id = ? AND status = 'claimed' RETURNING id",
      )
      .get(runId) as { id: string } | undefined
    if (!running) {
      log('debug', 'run.skipped', { run_id: runId, reason: 'cancelled_before_running' })
      return
    }
    // The run is now truly in flight — count it exactly once, here.
    recordRunStarted()
    started = true

    // d. Fetch trigger message
    const fallbackMsg = {
      id: runId,
      content: '(no trigger)',
      sender_type: 'user',
      sender_user_id: null as string | null,
      created_at: new Date().toISOString(),
      metadata: {} as Record<string, unknown>,
    }
    let triggerMsg = fallbackMsg
    if (runRow.trigger_msg_id) {
      const tm = db
        .prepare(
          'SELECT id, content, sender_type, sender_user_id, created_at, metadata FROM messages WHERE id = ?',
        )
        .get(runRow.trigger_msg_id) as
        | {
            id: string
            content: string
            sender_type: string
            sender_user_id: string | null
            created_at: string
            metadata: string
          }
        | undefined
      if (tm)
        triggerMsg = {
          ...tm,
          metadata: JSON.parse(tm.metadata || '{}') as Record<string, unknown>,
        } as typeof triggerMsg
    }

    const agentInfo = runRow.agents
    if (!agentInfo) throw new Error('Agent info missing from run row')

    // f. Build ContextPacketV1
    const packet = await buildContextPacket({
      run: {
        id: runId,
        room_id: runRow.room_id,
        round_index: runRow.round_index,
        discussion_mode: runRow.discussion_mode,
        deliberation_depth: runRow.deliberation_depth,
        deliberation_root_id: runRow.deliberation_root_id,
      },
      agentInfo,
      triggerMsg,
    })

    // g. Run adapter, collect final response. Resolve a BYO credential (ADR-0010) for
    // this agent — decrypted out-of-band and injected into the child env only (never
    // the packet/stdin/argv/logs). null = unchanged host-login behavior.
    const adapter = getAdapter(agentInfo.adapter_type ?? 'mock')
    const runtimeCredential = await resolveRuntimeProvider({
      adapterType: agentInfo.adapter_type,
      credentialId: agentInfo.credential_id,
      ownerUserId: agentInfo.created_by_user_id,
    })
    const controller = new AbortController()
    // Link an external abort (e.g. bridge shutdown) to this run's controller so the adapter's
    // kill-tree fires and the run finalizes cancelled rather than being left 'running' (A3).
    if (deps.signal) {
      if (deps.signal.aborted) controller.abort()
      else deps.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
    const stopCancellationWatcher = watchRunCancellation(
      runId,
      controller,
      deps.cancelPollMs ?? CANCEL_POLL_MS,
    )
    let finalContent = ''
    const handoffEvents: HandoffRequestedEvent[] = []

    try {
      for await (const event of adapter.run(
        packet,
        controller.signal,
        runtimeCredential ?? undefined,
      )) {
        if (event.type === 'final_response') {
          finalContent = event.response.content
        } else if (event.type === 'error') {
          if (controller.signal.aborted) throw new RunCancelledError()
          throw new Error(event.message)
        } else if (event.type === 'tool_call_requested') {
          const requiresApproval = event.requires_approval

          const tc = db
            .prepare(
              'INSERT INTO tool_calls (id, room_id, run_id, agent_id, tool_name, tool_category, input_args, status, requires_approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
            )
            .get(
              newId(),
              runRow.room_id,
              runRow.id,
              agentInfo.id,
              event.tool_name,
              event.tool_category ?? null,
              jsonText(event.arguments),
              requiresApproval ? 'waiting_approval' : 'queued',
              intBool(requiresApproval),
            ) as { id: string } | undefined

          if (tc) {
            const commandArg = (event.arguments['command'] as string | undefined) ?? ''
            if (isDeniedCommand(commandArg)) {
              db.prepare("UPDATE tool_calls SET status = 'denied', error = ? WHERE id = ?").run(
                'Command blocked by denylist',
                tc.id,
              )
              log('warn', 'tool.denied', {
                run_id: runId,
                tool_name: event.tool_name,
                reason: 'denylist',
              })
              throw new Error('Command blocked by denylist')
            }
          }

          if (tc && requiresApproval) {
            let finalStatus = 'failed'
            log('info', 'tool.approval.waiting', { run_id: runId, tool_name: event.tool_name })
            for (let i = 0; i < 15; i++) {
              if (controller.signal.aborted) throw new RunCancelledError()
              await new Promise<void>((r) => setTimeout(r, 2000))
              const updated = db
                .prepare('SELECT status FROM tool_calls WHERE id = ?')
                .get(tc.id) as { status?: string } | undefined
              if (updated?.status === 'approved') {
                finalStatus = 'approved'
                break
              }
              if (updated?.status === 'denied') {
                finalStatus = 'denied'
                break
              }
            }
            if (finalStatus === 'approved') {
              log('info', 'tool.approval.received', {
                run_id: runId,
                tool_name: event.tool_name,
                approved: true,
              })
              db.prepare("UPDATE tool_calls SET status = 'running' WHERE id = ?").run(tc.id)
              const result = { ok: true, stdout: 'approved' }
              db.prepare("UPDATE tool_calls SET status = 'succeeded', output = ? WHERE id = ?").run(
                redact(JSON.stringify(result)),
                tc.id,
              )
            } else {
              log(
                finalStatus === 'denied' ? 'info' : 'warn',
                finalStatus === 'denied' ? 'tool.approval.received' : 'tool.approval.timeout',
                {
                  run_id: runId,
                  tool_name: event.tool_name,
                  ...(finalStatus === 'denied' ? { approved: false } : {}),
                },
              )
              db.prepare('UPDATE tool_calls SET status = ?, error = ? WHERE id = ?').run(
                finalStatus === 'denied' ? 'denied' : 'failed',
                finalStatus === 'denied' ? null : 'approval timeout',
                tc.id,
              )
            }
          } else if (tc) {
            const result = { ok: true, stdout: 'executed' }
            db.prepare("UPDATE tool_calls SET status = 'succeeded', output = ? WHERE id = ?").run(
              redact(JSON.stringify(result)),
              tc.id,
            )
          }
        } else if (event.type === 'memory_op') {
          // Agent-curated memory: the bridge validates, injection-scans, and
          // persists (the agent never writes the DB). A bad op is logged + skipped
          // — it must never fail the run.
          await persistMemoryOp(event, {
            agentId: runRow.agent_id,
            roomId: runRow.room_id,
            triggerMessageId: runRow.trigger_msg_id ?? null,
          })
        } else if (event.type === 'handoff_requested') {
          // Defer hand-offs until the reply is inserted (it becomes the targeted
          // peer run's trigger message). Processed below, before mention follow-ups.
          handoffEvents.push(event)
        }
      }
    } finally {
      stopCancellationWatcher()
    }

    if (controller.signal.aborted) throw new RunCancelledError()
    if (!finalContent) throw new Error('Adapter produced no final_response')

    // h. Insert agent reply into messages
    const replyContent = redact(sanitizeAgentOutput(finalContent))
    const isConclusion = conclusionDetected(replyContent)
    const hallucination = detectHallucination(replyContent)
    // Canary lookahead (HalluCana): grounds claims against the real architecture and gates
    // propagation. Fail safe — any error becomes 'unverified', never 'verified'.
    let canary: { status: 'verified' | 'unverified' | 'flagged'; reasons: string[] }
    try {
      canary = runCanary(replyContent)
    } catch (err) {
      canary = {
        status: 'unverified',
        reasons: [`Canary error: ${err instanceof Error ? err.message : String(err)}`],
      }
    }
    log('info', 'canary.check', { run_id: runId, status: canary.status })
    log('info', 'hallucination.check', {
      run_id: runId,
      flagged: hallucination.flagged,
      confidence: hallucination.confidence,
    })
    // ADR-0011: when this run is part of a discussion, copy the discussion blackboard onto the
    // reply and stamp whether it substantively challenged a peer. The scoped peer query
    // (build-context-packet) matches replies by this metadata, so later phases can see this
    // agent's contribution; the challenge flag drives the anti-sycophancy / dissent gate.
    const disc = readDiscussionMetadata(triggerMsg.metadata)
    const metadata = {
      agent_loop: {
        is_conclusion: isConclusion,
        round_index: runRow.round_index,
      },
      hallucination: {
        flagged: hallucination.flagged,
        confidence: hallucination.confidence,
        reasons: hallucination.reasons,
        checked_at: new Date().toISOString(),
      },
      canary: {
        status: canary.status,
        reasons: canary.reasons,
        checked_at: new Date().toISOString(),
      },
      ...(disc
        ? {
            discussion: {
              enabled: true as const,
              command: disc.command,
              phase: disc.phase,
              original_message_id: disc.original_message_id,
              original_prompt: disc.original_prompt,
              challenge: detectChallenge(replyContent),
            },
          }
        : {}),
    }
    // h+i. Insert the reply AND mark the run completed ATOMICALLY, status-guarded. A user
    // cancel that lands after the adapter finished but before this point flips the run to
    // 'cancelled' in the DB; the guard then matches 0 rows, so the whole transaction (reply +
    // completion) rolls back and a cancelled run never posts a visible reply (A2). Throwing
    // RunCancelledError routes to the cancelled branch below. Property: reply + completion are
    // atomic — both land or neither (a non-cancel failure inside the txn fails the run, no orphan
    // reply). R3 holds separately: follow-ups run AFTER the txn under their own catch and the outer
    // 'failed' update is status-guarded, so neither path can flip an already-completed run.
    const finalize = db.transaction((): string => {
      const completedRows = db
        .prepare(
          "UPDATE agent_runs SET status = 'completed', completed_at = ? WHERE id = ? AND status IN ('claimed', 'running') RETURNING id",
        )
        .all(nowIso(), runId) as { id: string }[]
      if (completedRows.length === 0) throw new RunCancelledError()
      const inserted = db
        .prepare(
          "INSERT INTO messages (id, room_id, sender_type, sender_agent_id, content, content_type, round_index, metadata) VALUES (?, ?, 'agent', ?, ?, 'text', ?, ?) RETURNING id",
        )
        .get(
          newId(),
          runRow.room_id,
          runRow.agent_id,
          replyContent,
          runRow.round_index,
          jsonText(metadata),
        ) as { id: string } | undefined
      if (!inserted) throw new Error('Failed to insert agent reply')
      return inserted.id
    })
    let insertedMessageId: string
    try {
      insertedMessageId = finalize()
    } catch (finalizeErr) {
      // Cross-process race: the web cancel route and this finalize transaction are separate
      // SQLite writers on the same file. busy_timeout (5s) normally absorbs contention, but if
      // this transaction still loses the write lock it throws SQLITE_BUSY (not RunCancelledError).
      // Re-read the authoritative status — a run the user just cancelled must finalize 'cancelled',
      // not 'failed'. (Reasoned, not unit-tested: the all-in-process suite can't stage two writers.)
      const code = (finalizeErr as { code?: string } | null)?.code
      if (code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT') {
        const cur = db.prepare('SELECT status FROM agent_runs WHERE id = ?').get(runId) as
          | { status?: string }
          | undefined
        if (cur?.status === 'cancelled') throw new RunCancelledError()
      }
      throw finalizeErr
    }
    // Post-completion orchestration (hand-offs/mentions/discussion) is BEST-EFFORT:
    // an error here must NEVER flip this already-completed run to 'failed' (R3). It is
    // wrapped in its own log-and-continue try/catch, like memory_op, so follow-up
    // failures cannot reach the outer catch.
    try {
      // Agent-to-agent hand-offs (Phase 10) — create targeted peer runs under the
      // loop guards + cycle detection. Processed BEFORE mention follow-ups so the
      // follow-up dedup sees any hand-off runs already created at the next round.
      // Cap the count per run to bound fan-out amplification (each is still
      // round/hop/cycle-guarded); drop + log the excess.
      // ADR-0011: in a discussion the PHASE MACHINE is the sole turn driver. Discussion phase
      // prompts deliberately ask agents to reference peers by @slug, so the generic
      // mention-follow-up / hand-off paths would otherwise spawn uncontrolled extra runs off
      // those @mentions (observed live as stray phase-mislabeled turns). Suppress both for
      // discussion runs; only the orchestrator advances the discussion.
      if (!disc) {
        if (handoffEvents.length > MAX_HANDOFFS_PER_RUN) {
          log('warn', 'handoff.capped', {
            run_id: runId,
            requested: handoffEvents.length,
            cap: MAX_HANDOFFS_PER_RUN,
          })
        }
        for (const handoff of handoffEvents.slice(0, MAX_HANDOFFS_PER_RUN)) {
          await handleHandoffRequest(handoff, {
            roomId: runRow.room_id,
            sourceAgentId: runRow.agent_id,
            sourceMessageId: insertedMessageId,
            currentRun: {
              id: runRow.id,
              round_index: runRow.round_index,
              deliberation_depth: runRow.deliberation_depth,
              deliberation_root_id: runRow.deliberation_root_id,
              discussion_mode: runRow.discussion_mode,
            },
          })
        }
        await maybeScheduleAgentMentionFollowUps({
          currentRun: {
            id: runRow.id,
            discussion_mode: runRow.discussion_mode,
            deliberation_depth: runRow.deliberation_depth,
            deliberation_root_id: runRow.deliberation_root_id,
          },
          roomId: runRow.room_id,
          sourceAgentId: runRow.agent_id,
          sourceMessageId: insertedMessageId,
          replyContent,
          roundIndex: runRow.round_index,
        })
      }
      await maybeScheduleDiscussionContinuation({
        roomId: runRow.room_id,
        currentRoundIndex: runRow.round_index,
        triggerMessage: triggerMsg,
      })
    } catch (followupErr) {
      // The run is genuinely completed; a scheduling failure is logged, not fatal.
      captureError(followupErr, { run_id: runId, where: 'processRun.followups' })
      log('error', 'run.followup_failed', {
        run_id: runId,
        error: redact(followupErr instanceof Error ? followupErr.message : String(followupErr)),
      })
    }
    recordRunCompleted(Date.now() - startedAt)
    log('info', 'run.complete', { run_id: runId, duration_ms: Date.now() - startedAt })
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err))
    if (err instanceof RunCancelledError) {
      db.prepare(
        "UPDATE agent_runs SET status = 'cancelled', error_message = ?, completed_at = ? WHERE id = ? AND status IN ('claimed', 'running')",
      ).run(message, nowIso(), runId)
      if (started) recordRunCancelled()
      log('warn', 'run.cancelled', { run_id: runId })
      return
    }
    // STATUS-GUARDED: only a still-in-flight run becomes 'failed'. Never clobber a
    // run that already reached a terminal state (completed/cancelled) — this is the
    // core R3 protection against an error after the completed write.
    db.prepare(
      "UPDATE agent_runs SET status = 'failed', error_message = ? WHERE id = ? AND status IN ('claimed', 'running')",
    ).run(message, runId)
    if (started) recordRunFailed()
    captureError(err, { run_id: runId, where: 'processRun' })
    log('error', 'run.failed', { run_id: runId, error: message })
    throw err
  }
}

function watchRunCancellation(
  runId: string,
  controller: AbortController,
  pollMs: number = CANCEL_POLL_MS,
): () => void {
  const db = getDb()
  const interval = setInterval(() => {
    if (controller.signal.aborted) return

    try {
      const data = db.prepare('SELECT status FROM agent_runs WHERE id = ?').get(runId) as
        | { status?: string }
        | undefined
      if (data?.status === 'cancelled') {
        controller.abort()
      }
    } catch {
      // Best-effort cancellation watcher; the main run path owns error handling.
    }
  }, pollMs)

  return () => clearInterval(interval)
}
