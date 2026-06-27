import { getDb, newId } from '@agentroom/db'

import { parseMentions } from './mention-parser.js'

type DiscussionMode = 'independent' | 'tag_turns'

interface AgentRow {
  id: string
  name: string
  slug: string
  is_active: boolean
}

interface AgentMemberRow {
  agent_id: string
  muted: boolean
  reply_enabled: boolean
  agents: AgentRow
}

interface CurrentRun {
  id: string
  discussion_mode: DiscussionMode
  deliberation_depth: number
  deliberation_root_id: string | null
}

interface RoomDeliberationSettings {
  max_agent_rounds?: number
}

export async function maybeScheduleAgentMentionFollowUps({
  currentRun,
  roomId,
  sourceAgentId,
  sourceMessageId,
  replyContent,
  roundIndex,
}: {
  currentRun: CurrentRun
  roomId: string
  sourceAgentId: string
  sourceMessageId: string
  replyContent: string
  roundIndex: number
}): Promise<string[]> {
  if (currentRun.discussion_mode !== 'tag_turns') return []

  const db = getDb()

  const room = db.prepare('SELECT max_agent_rounds FROM rooms WHERE id = ?').get(roomId) as
    | RoomDeliberationSettings
    | undefined

  const settings = (room ?? null) as RoomDeliberationSettings | null
  const maxDepth = Math.max((settings?.max_agent_rounds ?? 1) - 1, 0)
  if (maxDepth <= 0 || currentRun.deliberation_depth >= maxDepth) return []

  const nextRoundIndex = roundIndex + 1
  const nextDepth = currentRun.deliberation_depth + 1
  const deliberationRootId = currentRun.deliberation_root_id ?? currentRun.id

  const rawMembers = db
    .prepare(
      `SELECT rm.agent_id AS agent_id,
              rm.muted AS muted,
              rm.reply_enabled AS reply_enabled,
              a.id AS a_id,
              a.name AS a_name,
              a.slug AS a_slug,
              a.is_active AS a_is_active
         FROM room_members rm
         JOIN agents a ON a.id = rm.agent_id
        WHERE rm.room_id = ?
          AND rm.member_type = 'agent'
          AND rm.reply_enabled = 1
          AND rm.muted = 0`,
    )
    .all(roomId) as Array<{
    agent_id: string
    muted: number
    reply_enabled: number
    a_id: string
    a_name: string
    a_slug: string
    a_is_active: number
  }>

  const members = rawMembers
    .map(
      (row): AgentMemberRow => ({
        agent_id: row.agent_id,
        muted: row.muted === 1,
        reply_enabled: row.reply_enabled === 1,
        agents: {
          id: row.a_id,
          name: row.a_name,
          slug: row.a_slug,
          is_active: row.a_is_active === 1,
        },
      }),
    )
    .filter((member) => member.agents?.is_active)

  const mentions = parseMentions(
    replyContent,
    members.map((member) => member.agents),
  )
  const explicitTargetIds = mentions
    .filter((mention) => mention.type === 'agent' && mention.agent_id)
    .map((mention) => mention.agent_id as string)

  const targetIds = [...new Set(explicitTargetIds)].filter((agentId) => agentId !== sourceAgentId)
  if (targetIds.length === 0) return []

  const existingRuns = db
    .prepare('SELECT agent_id FROM agent_runs WHERE trigger_msg_id = ? AND round_index = ?')
    .all(sourceMessageId, nextRoundIndex) as Array<{ agent_id: string }>

  const existingAgentIds = new Set(existingRuns.map((run) => run.agent_id))
  const newTargetIds = targetIds.filter((agentId) => !existingAgentIds.has(agentId))
  if (newTargetIds.length === 0) return []

  const insert = db.prepare(
    `INSERT INTO agent_runs
       (id, room_id, agent_id, trigger_msg_id, status, round_index, discussion_mode, deliberation_depth, deliberation_root_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const agentId of newTargetIds) {
    insert.run(
      newId(),
      roomId,
      agentId,
      sourceMessageId,
      'queued',
      nextRoundIndex,
      'tag_turns',
      nextDepth,
      deliberationRootId,
    )
  }

  return newTargetIds
}
