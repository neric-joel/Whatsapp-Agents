import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { log } from '../lib/logger.js'
import { normalizeSlug } from '../lib/mention-parser.js'

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
  supabase: SupabaseClient
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
    // 1. Room guards.
    const { data: roomRaw } = await ctx.supabase
      .from('rooms')
      .select('allow_agent_to_agent, max_agent_rounds, max_agent_hops')
      .eq('id', ctx.roomId)
      .single()
    const room = roomRaw as RoomGuards | null
    if (!room) return blocked('room_missing', ctx, op)
    if (!room.allow_agent_to_agent) return blocked('agent_to_agent_disabled', ctx, op)

    // 2. Resolve the target peer (active, unmuted, reply-enabled room agent).
    const { data: rawMembers } = await ctx.supabase
      .from('room_members')
      .select('agent_id, agents!inner(id, slug, is_active)')
      .eq('room_id', ctx.roomId)
      .eq('member_type', 'agent')
      .eq('reply_enabled', true)
      .eq('muted', false)
    const members = ((rawMembers ?? []) as unknown as MemberRow[]).filter(
      (m) => m.agents?.is_active,
    )
    const target = members.find((m) => m.agents && normalizeSlug(m.agents.slug) === targetSlugNorm)
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
    const chainAgents = await collectChainAgents(ctx.supabase, rootId)
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
    const { data: existing } = await ctx.supabase
      .from('agent_runs')
      .select('id')
      .eq('room_id', ctx.roomId)
      .eq('trigger_msg_id', ctx.sourceMessageId)
      .eq('agent_id', targetAgentId)
      .eq('round_index', nextRoundIndex)
      .limit(1)
    if ((existing ?? []).length > 0) return { ok: false, reason: 'duplicate' }

    // 7. Create the targeted peer run.
    const { error } = await ctx.supabase.from('agent_runs').insert({
      room_id: ctx.roomId,
      agent_id: targetAgentId,
      trigger_msg_id: ctx.sourceMessageId,
      status: 'queued',
      round_index: nextRoundIndex,
      discussion_mode: ctx.currentRun.discussion_mode,
      deliberation_depth: nextDepth,
      deliberation_root_id: rootId,
    })
    if (error) {
      log('warn', 'handoff.persist_failed', { error: error.message, room_id: ctx.roomId })
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
async function collectChainAgents(supabase: SupabaseClient, rootId: string): Promise<Set<string>> {
  const agents = new Set<string>()
  const { data: rootRun } = await supabase
    .from('agent_runs')
    .select('agent_id')
    .eq('id', rootId)
    .single()
  if (rootRun) agents.add((rootRun as { agent_id: string }).agent_id)
  const { data: descendants } = await supabase
    .from('agent_runs')
    .select('agent_id')
    .eq('deliberation_root_id', rootId)
  for (const row of (descendants ?? []) as Array<{ agent_id: string }>) agents.add(row.agent_id)
  return agents
}

async function postSystemMessage(ctx: HandoffContext, content: string): Promise<void> {
  await ctx.supabase.from('messages').insert({
    room_id: ctx.roomId,
    sender_type: 'system',
    content,
    content_type: 'text',
    mentions: [],
    target_agent_ids: [],
    round_index: ctx.currentRun.round_index,
  })
}

function blocked(
  reason: string,
  ctx: HandoffContext,
  op: { to_agent_slug: string },
): HandoffResult {
  log('info', 'handoff.blocked', { reason, room_id: ctx.roomId, to_slug: op.to_agent_slug })
  return { ok: false, reason }
}
