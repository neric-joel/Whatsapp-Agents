import { getDb, rowToMemoryEntry } from '@agentroom/db'
import type { ContextPacketV1, MemoryEntry, UserProfileSummary } from '@agentroom/shared'

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
 * unit-tested without a DB: keeps the highest-ranked entries (recall returns them
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
 * Build the ContextPacketV1.memory field via ranked recall over SQLite. Resilient:
 * any failure logs and returns undefined rather than breaking the run.
 */
export async function recallMemory(
  params: RecallParams,
): Promise<ContextPacketV1['memory'] | undefined> {
  const maxEntries = readMemoryMaxEntries()
  const maxChars = readMemoryMaxChars()
  if (maxEntries <= 0) return undefined

  let agent: MemoryEntry[] = []
  try {
    const data = recallAgentMemory({
      agentId: params.agentId,
      roomId: params.roomId,
      query: params.queryText ?? '',
      limit: maxEntries,
      userId: params.userId ?? null,
    })
    agent = applyMemoryBudget(data, maxEntries, maxChars)
  } catch (err) {
    log('warn', 'memory.recall.error', {
      error: err instanceof Error ? err.message : String(err),
      room_id: params.roomId,
    })
  }

  const user = params.userId ? recallUserProfile(params.userId) : undefined

  if (agent.length === 0 && !user) return undefined
  return { agent, ...(user ? { user } : {}) }
}

interface RecallAgentMemoryArgs {
  agentId: string | null
  roomId: string
  query: string
  limit: number
  userId: string | null
}

/**
 * JS reimplementation of the former Postgres `recall_agent_memory` RPC over
 * SQLite (NO FTS). Selects the active memory visible to (agent within room):
 * room-shared notes + this agent's room memory, this agent's global memory, and
 * the triggering user's personal global notes. When a query string is given,
 * keeps only rows whose title/content contain a query term (LIKE). Ranked by
 * pinned DESC, then query-match DESC, then confidence DESC, then created_at DESC,
 * limited to GREATEST(limit, 1).
 */
function recallAgentMemory(args: RecallAgentMemoryArgs): MemoryEntry[] {
  const db = getDb()
  // Scope predicate mirrors recall_agent_memory: is_active AND
  //   (room-shared notes + this agent's room memory)
  //   OR (this agent's global memory)
  //   OR (the triggering user's personal global notes)
  const rows = db
    .prepare(
      `SELECT * FROM agent_memory m
       WHERE m.is_active = 1
         AND (
           (m.scope = 'room' AND m.room_id = ?
             AND (? IS NULL OR m.agent_id = ? OR m.agent_id IS NULL))
           OR (m.scope = 'global' AND ? IS NOT NULL AND m.agent_id = ?)
           OR (m.scope = 'global' AND ? IS NOT NULL AND m.created_by_user_id = ?)
         )`,
    )
    .all(
      args.roomId,
      args.agentId,
      args.agentId,
      args.agentId,
      args.agentId,
      args.userId,
      args.userId,
    )
    .map((r) => rowToMemoryEntry(r as Record<string, unknown>))

  const query = args.query ?? ''
  const hasQuery = query !== ''
  const terms = hasQuery
    ? query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0)
    : []

  // Score of a row against the query terms (0 when no query) — the LIKE analog of
  // ts_rank: count of distinct query terms found in the title+content haystack.
  const score = (row: MemoryEntry): number => {
    if (!hasQuery) return 0
    const haystack = `${row.title ?? ''} ${row.content}`.toLowerCase()
    let n = 0
    for (const term of terms) {
      if (haystack.includes(term)) n += 1
    }
    return n
  }

  // When a query string is given, prefer rows whose title/content LIKE a query
  // term — drop rows that match none (mirrors the `search_tsv @@ tsquery` filter).
  const filtered = hasQuery ? rows.filter((row) => score(row) > 0) : rows

  filtered.sort((a, b) => {
    // pinned DESC
    const pinnedDiff = Number(b.pinned) - Number(a.pinned)
    if (pinnedDiff !== 0) return pinnedDiff
    // query-rank DESC (0 when no query)
    const rankDiff = score(b) - score(a)
    if (rankDiff !== 0) return rankDiff
    // confidence DESC
    const confDiff = b.confidence - a.confidence
    if (confDiff !== 0) return confDiff
    // created_at DESC (ISO-8601 text sorts lexicographically)
    if (a.created_at < b.created_at) return 1
    if (a.created_at > b.created_at) return -1
    return 0
  })

  const limit = Math.max(args.limit, 1)
  return filtered.slice(0, limit)
}

function recallUserProfile(userId: string): UserProfileSummary | undefined {
  try {
    const db = getDb()
    const data = db
      .prepare('SELECT summary, details, consented FROM user_profile WHERE user_id = ?')
      .get(userId) as
      | {
          summary: string | null
          details: string
          consented: number
        }
      | undefined
    if (!data) return undefined
    const row = {
      summary: data.summary,
      details: parseDetails(data.details),
      consented: data.consented === 1,
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

function parseDetails(value: string | null | undefined): Record<string, unknown> {
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return {}
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
