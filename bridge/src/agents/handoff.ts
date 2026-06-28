import { getDb, jsonText, newId } from '@agentroom/db'
import { normalizeSlug } from '@agentroom/shared'
import { z } from 'zod'

import { log } from '../lib/logger.js'

type DiscussionMode = 'independent' | 'tag_turns'

/**
 * Phase 10 agent-to-agent hand-off. An agent emits a `handoff_requested` event;
 * the bridge (service role) resolves the target peer and creates a TARGETED
 * agent_run for it — subject to the room's loop guards (`allow_agent_to_agent`,
 * `max_agent_rounds`, `max_agent_hops`) PLUS cycle detection on the hand-off
 * chain. The agent never writes the DB. A blocked or invalid hand-off is logged
 * + (for caps) surfaced as a system message, and NEVER crashes the run — chains
 * provably terminate because depth strictly increases and is bounded by
 * `max_agent_hops` (and rounds by `max_agent_rounds`), and a repeat participant
 * is rejected as a cycle.
 */
const handoffSchema = z.object({
  type: z.literal('handoff_requested'),
  run_id: z.string(),
  to_agent_slug: z.string().min(1).max(100),
  reason: z.string().max(2000),
  payload: z.string().max(8000).optional(),
})

interface HandoffContext {
  roomId: string
  sourceAgentId: string
  /** The agent's reply message — the trigger for the targeted peer run. */
  sourceMessageId: string
  currentRun: {
    id: string
    round_index: number
    deliberation_depth: number
    deliberation_root_id: string | null
    discussion_mode: DiscussionMode
  }
}

type HandoffResult =
  | { ok: true; targetAgentId: string; targetSlug: string }
  | { ok: false; reason: string }

interface RoomGuards {
  allow_agent_to_agent: boolean
  max_agent_rounds: number
  max_agent_hops: number
}

interface MemberRow {
  agent_id: string
  agents: { id: string; slug: string; is_active: boolean } | null
}

export async function handleHandoffRequest(
  event: unknown,
  ctx: HandoffContext,
): Promise<HandoffResult> {
  const parsed = handoffSchema.safeParse(event)
  if (!parsed.success) {
    log('warn', 'handoff.invalid', {
      reason: parsed.error.issues.map((i) => i.message).join('; '),
      room_id: ctx.roomId,
    })
    return { ok: false, reason: 'invalid' }
  }
  const op = parsed.data
  const targetSlugNorm = normalizeSlug(op.to_agent_slug)

  try {
    const db = getDb()

    // 1. Room guards.
    const roomRaw = db
      .prepare(
        'SELECT allow_agent_to_agent, max_agent_rounds, max_agent_hops FROM rooms WHERE id = ?',
      )
      .get(ctx.roomId) as
      | { allow_agent_to_agent: number; max_agent_rounds: number; max_agent_hops: number }
      | undefined
    const room: RoomGuards | null = roomRaw
      ? {
          allow_agent_to_agent: roomRaw.allow_agent_to_agent === 1,
          max_agent_rounds: roomRaw.max_agent_rounds,
          max_agent_hops: roomRaw.max_agent_hops,
        }
      : null
    if (!room) return blocked('room_missing', ctx, op)
    if (!room.allow_agent_to_agent) return blocked('agent_to_agent_disabled', ctx, op)

    // 2. Resolve the target peer (active, unmuted, reply-enabled room agent).
    const rawMembers = db
      .prepare(
        `SELECT rm.agent_id AS agent_id, a.id AS a_id, a.slug AS a_slug, a.is_active AS a_is_active
           FROM room_members rm
           JOIN agents a ON a.id = rm.agent_id
          WHERE rm.room_id = ?
            AND rm.member_type = 'agent'
            AND rm.reply_enabled = 1
            AND rm.muted = 0`,
      )
      .all(ctx.roomId) as Array<{
      agent_id: string
      a_id: string
      a_slug: string
      a_is_active: number
    }>
    const members: MemberRow[] = rawMembers.map((r) => ({
      agent_id: r.agent_id,
      agents: { id: r.a_id, slug: r.a_slug, is_active: r.a_is_active === 1 },
    }))
    const activeMembers = members.filter((m) => m.agents?.is_active)
    const target = activeMembers.find(
      (m) => m.agents && normalizeSlug(m.agents.slug) === targetSlugNorm,
    )
    if (!target || !target.agents) return blocked('unknown_target', ctx, op)
    const targetAgentId = target.agent_id

    // 3. No self hand-off (a trivial cycle).
    if (targetAgentId === ctx.sourceAgentId) return blocked('self_handoff', ctx, op)

    // 4. Loop guards — rounds and hops. Cap → terminate the chain with a visible
    //    system message so users see why deliberation stopped.
    const nextRoundIndex = ctx.currentRun.round_index + 1
    const nextDepth = ctx.currentRun.deliberation_depth + 1
    if (nextRoundIndex >= room.max_agent_rounds) {
      await postSystemMessage(ctx, `Deliberation ended (round limit: ${room.max_agent_rounds}).`)
      return blocked('round_cap', ctx, op)
    }
    if (nextDepth > room.max_agent_hops) {
      await postSystemMessage(ctx, `Deliberation ended (hop limit: ${room.max_agent_hops}).`)
      return blocked('hop_cap', ctx, op)
    }

    // 5. Cycle detection — reject a hand-off to an agent already in this chain.
    //    All chain members share deliberation_root_id; include the root run's own
    //    agent (its root_id is null, so it isn't in the descendants query).
    const rootId = ctx.currentRun.deliberation_root_id ?? ctx.currentRun.id
    const chainAgents = collectChainAgents(rootId)
    chainAgents.add(ctx.sourceAgentId)
    if (chainAgents.has(targetAgentId)) {
      log('info', 'handoff.cycle_blocked', {
        room_id: ctx.roomId,
        to_slug: targetSlugNorm,
        root_id: rootId,
      })
      await postSystemMessage(
        ctx,
        `Deliberation ended (cycle detected: @${op.to_agent_slug} already participated).`,
      )
      return { ok: false, reason: 'cycle' }
    }

    // 6. Dedup: don't create a second run for this target at this round/message.
    const existing = db
      .prepare(
        `SELECT id FROM agent_runs
          WHERE room_id = ? AND trigger_msg_id = ? AND agent_id = ? AND round_index = ?
          LIMIT 1`,
      )
      .all(ctx.roomId, ctx.sourceMessageId, targetAgentId, nextRoundIndex)
    if (existing.length > 0) return { ok: false, reason: 'duplicate' }

    // 7. Create the targeted peer run.
    try {
      db.prepare(
        `INSERT INTO agent_runs (
           id, room_id, agent_id, trigger_msg_id, status, round_index,
           discussion_mode, deliberation_depth, deliberation_root_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId(),
        ctx.roomId,
        targetAgentId,
        ctx.sourceMessageId,
        'queued',
        nextRoundIndex,
        ctx.currentRun.discussion_mode,
        nextDepth,
        rootId,
      )
    } catch (error) {
      log('warn', 'handoff.persist_failed', {
        error: error instanceof Error ? error.message : String(error),
        room_id: ctx.roomId,
      })
      return { ok: false, reason: 'persist_failed' }
    }

    log('info', 'handoff.created', {
      room_id: ctx.roomId,
      from_agent_id: ctx.sourceAgentId,
      to_agent_id: targetAgentId,
      to_slug: targetSlugNorm,
      round_index: nextRoundIndex,
      deliberation_depth: nextDepth,
    })
    return { ok: true, targetAgentId, targetSlug: targetSlugNorm }
  } catch (err) {
    log('warn', 'handoff.error', {
      error: err instanceof Error ? err.message : String(err),
      room_id: ctx.roomId,
    })
    return { ok: false, reason: 'exception' }
  }
}

/** Every agent that has appeared in the hand-off chain rooted at rootId. */
function collectChainAgents(rootId: string): Set<string> {
  const db = getDb()
  const agents = new Set<string>()
  const rootRun = db.prepare('SELECT agent_id FROM agent_runs WHERE id = ?').get(rootId) as
    | { agent_id: string }
    | undefined
  if (rootRun) agents.add(rootRun.agent_id)
  const descendants = db
    .prepare('SELECT agent_id FROM agent_runs WHERE deliberation_root_id = ?')
    .all(rootId) as Array<{ agent_id: string }>
  for (const row of descendants) agents.add(row.agent_id)
  return agents
}

async function postSystemMessage(ctx: HandoffContext, content: string): Promise<void> {
  const db = getDb()
  db.prepare(
    `INSERT INTO messages (
       id, room_id, sender_type, content, content_type, mentions, target_agent_ids, round_index
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    ctx.roomId,
    'system',
    content,
    'text',
    jsonText([]),
    jsonText([]),
    ctx.currentRun.round_index,
  )
}

function blocked(
  reason: string,
  ctx: HandoffContext,
  op: { to_agent_slug: string },
): HandoffResult {
  log('info', 'handoff.blocked', { reason, room_id: ctx.roomId, to_slug: op.to_agent_slug })
  return { ok: false, reason }
}
