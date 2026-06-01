import type { ContextPacketV1, MemoryEntry, UserProfileSummary } from '@agentroom/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

import { log } from '../lib/logger.js'

const DEFAULT_MEMORY_MAX_ENTRIES = 8
const DEFAULT_MEMORY_MAX_CHARS = 4000

function readMemoryMaxEntries(env: NodeJS.ProcessEnv = process.env): number {
  return readBoundedInt(env.AGENTROOM_MEMORY_MAX_ENTRIES, DEFAULT_MEMORY_MAX_ENTRIES, 0, 50)
}

function readMemoryMaxChars(env: NodeJS.ProcessEnv = process.env): number {
  return readBoundedInt(env.AGENTROOM_MEMORY_MAX_CHARS, DEFAULT_MEMORY_MAX_CHARS, 0, 32_000)
}

/**
 * Apply the count + character budget to ranked memory rows. Pure so it can be
 * unit-tested without a DB: keeps the highest-ranked entries (RPC returns them
 * ranked) until either the entry cap or the cumulative char budget is hit.
 *
 * The char budget bounds RAW title+content only — the rendered prompt block adds
 * a fixed header plus per-line `> ` quoting overhead (see format-memory.ts), so
 * the rendered size is somewhat larger. It's a soft budget, not a hard token cap.
 */
export function applyMemoryBudget(
  rows: MemoryEntry[],
  maxEntries: number,
  maxChars: number,
): MemoryEntry[] {
  if (maxEntries <= 0 || maxChars <= 0) return []
  const out: MemoryEntry[] = []
  let chars = 0
  for (const row of rows) {
    if (out.length >= maxEntries) break
    const cost = (row.title?.length ?? 0) + row.content.length
    // Always allow at least one entry even if it alone exceeds the budget.
    if (out.length > 0 && chars + cost > maxChars) break
    out.push(row)
    chars += cost
  }
  return out
}

interface RecallParams {
  agentId: string | null
  roomId: string
  queryText: string
  userId?: string | null
}

/**
 * Build the ContextPacketV1.memory field via ranked Postgres FTS. Resilient:
 * any failure logs and returns undefined rather than breaking the run.
 */
export async function recallMemory(
  supabase: SupabaseClient,
  params: RecallParams,
): Promise<ContextPacketV1['memory'] | undefined> {
  const maxEntries = readMemoryMaxEntries()
  const maxChars = readMemoryMaxChars()
  if (maxEntries <= 0) return undefined

  let agent: MemoryEntry[] = []
  try {
    const { data, error } = await supabase.rpc('recall_agent_memory', {
      p_agent_id: params.agentId,
      p_room_id: params.roomId,
      p_query: params.queryText ?? '',
      p_limit: maxEntries,
      p_user_id: params.userId ?? null,
    })
    if (error) {
      log('warn', 'memory.recall.failed', { error: error.message, room_id: params.roomId })
    } else if (Array.isArray(data)) {
      agent = applyMemoryBudget(data as MemoryEntry[], maxEntries, maxChars)
    }
  } catch (err) {
    log('warn', 'memory.recall.error', {
      error: err instanceof Error ? err.message : String(err),
      room_id: params.roomId,
    })
  }

  const user = params.userId ? await recallUserProfile(supabase, params.userId) : undefined

  if (agent.length === 0 && !user) return undefined
  return { agent, ...(user ? { user } : {}) }
}

async function recallUserProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserProfileSummary | undefined> {
  try {
    const { data, error } = await supabase
      .from('user_profile')
      .select('summary, details, consented')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return undefined
    const row = data as {
      summary: string | null
      details: Record<string, unknown>
      consented: boolean
    }
    // Agents see the profile only with explicit consent (Hermes USER.md gate).
    if (!row.consented || !row.summary?.trim()) return undefined
    return { summary: row.summary.trim(), details: row.details }
  } catch (err) {
    log('warn', 'memory.user_profile.error', {
      error: err instanceof Error ? err.message : String(err),
      user_id: userId,
    })
    return undefined
  }
}

function readBoundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}
