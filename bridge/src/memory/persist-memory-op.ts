import { getDb, intBool, newId } from '@agentroom/db'
import { scanMemoryContent } from '@agentroom/shared'
import { z } from 'zod'

import { log } from '../lib/logger.js'

/**
 * Validate + persist a `memory_op` AgentEvent emitted by an agent.
 *
 * The agent NEVER writes the DB directly — it emits an event and the bridge
 * (service role) validates, injection-scans, sanitizes, and persists. There is
 * deliberately NO field by which a memory op can grant tool permissions or alter
 * a persona: it can only store labelled DATA.
 */
const memoryOpSchema = z.object({
  type: z.literal('memory_op'),
  run_id: z.string(),
  op: z.enum(['add', 'replace', 'consolidate']),
  scope: z.enum(['global', 'room']),
  kind: z.enum(['fact', 'preference', 'skill', 'episodic']),
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(8000),
  target_id: z.string().uuid().optional(),
})

interface PersistMemoryContext {
  agentId: string
  roomId: string
  triggerMessageId: string | null
}

interface PersistMemoryResult {
  ok: boolean
  id?: string
  flagged?: boolean
  reason?: string
}

export async function persistMemoryOp(
  event: unknown,
  ctx: PersistMemoryContext,
): Promise<PersistMemoryResult> {
  const parsed = memoryOpSchema.safeParse(event)
  if (!parsed.success) {
    const reason = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    log('warn', 'memory.op.invalid', { reason, agent_id: ctx.agentId, room_id: ctx.roomId })
    return { ok: false, reason }
  }
  const op = parsed.data
  const scan = scanMemoryContent(op.content)
  const title = op.title ? scanMemoryContent(op.title).sanitized.slice(0, 200) : null

  try {
    const db = getDb()

    // replace/consolidate supersede a prior entry — deactivate it, scoped to this
    // agent so an agent can never tamper with another agent's (or a user's) memory.
    if (op.op === 'replace' || op.op === 'consolidate') {
      if (op.target_id) {
        db.prepare('UPDATE agent_memory SET is_active = ? WHERE id = ? AND agent_id = ?').run(
          intBool(false),
          op.target_id,
          ctx.agentId,
        )
      } else {
        // No target → this degrades to a plain insert (a duplicate, not a replace).
        // Log it so the no-op is observable rather than silent.
        log('warn', 'memory.op.supersede_noop', {
          op: op.op,
          agent_id: ctx.agentId,
          room_id: ctx.roomId,
        })
      }
    }

    let data: { id: string } | undefined
    let error: Error | null = null
    try {
      data = db
        .prepare(
          `INSERT INTO agent_memory (id, agent_id, room_id, scope, kind, title, content, source_message_id, injection_flagged)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id`,
        )
        .get(
          newId(),
          ctx.agentId,
          op.scope === 'room' ? ctx.roomId : null,
          op.scope,
          op.kind,
          title,
          scan.sanitized,
          ctx.triggerMessageId,
          intBool(scan.flagged),
        ) as { id: string } | undefined
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
    }

    if (error || !data) {
      log('warn', 'memory.op.persist_failed', {
        error: error?.message ?? 'no row returned',
        agent_id: ctx.agentId,
        room_id: ctx.roomId,
      })
      return { ok: false, flagged: scan.flagged, reason: error?.message ?? 'persist failed' }
    }

    log('info', 'memory.op.persisted', {
      memory_id: (data as { id: string }).id,
      op: op.op,
      scope: op.scope,
      kind: op.kind,
      injection_flagged: scan.flagged,
      agent_id: ctx.agentId,
      room_id: ctx.roomId,
    })
    return { ok: true, id: (data as { id: string }).id, flagged: scan.flagged }
  } catch (err) {
    log('warn', 'memory.op.error', {
      error: err instanceof Error ? err.message : String(err),
      agent_id: ctx.agentId,
      room_id: ctx.roomId,
    })
    return { ok: false, flagged: scan.flagged, reason: 'exception' }
  }
}
