import type { SupabaseClient } from '@supabase/supabase-js'
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

export async function maybeScheduleAgentMentionFollowUps({
  supabase,
  currentRun,
  roomId,
  sourceAgentId,
  sourceMessageId,
  replyContent,
  roundIndex,
}: {
  supabase: SupabaseClient
  currentRun: CurrentRun
  roomId: string
  sourceAgentId: string
  sourceMessageId: string
  replyContent: string
  roundIndex: number
}): Promise<string[]> {
  if (currentRun.discussion_mode !== 'tag_turns') return []

  const { data: room } = await supabase
    .from('rooms')
    .select('allow_agent_to_agent, max_agent_rounds')
    .eq('id', roomId)
    .single()

  const allowAgentToAgent = Boolean((room as { allow_agent_to_agent?: boolean } | null)?.allow_agent_to_agent)
  const maxRounds = (room as { max_agent_rounds?: number } | null)?.max_agent_rounds ?? 0
  if (!allowAgentToAgent || maxRounds <= 0 || currentRun.deliberation_depth >= maxRounds - 1) return []

  const nextRoundIndex = roundIndex + 1
  const nextDepth = currentRun.deliberation_depth + 1
  const deliberationRootId = currentRun.deliberation_root_id ?? currentRun.id

  const { data: rawMembers } = await supabase
    .from('room_members')
    .select('agent_id, muted, reply_enabled, agents!inner(id, name, slug, is_active)')
    .eq('room_id', roomId)
    .eq('member_type', 'agent')
    .eq('reply_enabled', true)
    .eq('muted', false)

  const members = ((rawMembers ?? []) as unknown as AgentMemberRow[])
    .filter((member) => member.agents?.is_active)

  const mentions = parseMentions(replyContent, members.map((member) => member.agents))
  const explicitTargetIds = mentions
    .filter((mention) => mention.type === 'agent' && mention.agent_id)
    .map((mention) => mention.agent_id as string)

  const targetIds = [...new Set(explicitTargetIds)].filter((agentId) => agentId !== sourceAgentId)
  if (targetIds.length === 0) return []

  const { data: existingRuns } = await supabase
    .from('agent_runs')
    .select('agent_id')
    .eq('trigger_msg_id', sourceMessageId)
    .eq('round_index', nextRoundIndex)

  const existingAgentIds = new Set((existingRuns ?? []).map((run) => (run as { agent_id: string }).agent_id))
  const newTargetIds = targetIds.filter((agentId) => !existingAgentIds.has(agentId))
  if (newTargetIds.length === 0) return []

  await supabase.from('agent_runs').insert(newTargetIds.map((agentId) => ({
    room_id: roomId,
    agent_id: agentId,
    trigger_msg_id: sourceMessageId,
    status: 'queued',
    round_index: nextRoundIndex,
    discussion_mode: 'tag_turns',
    deliberation_depth: nextDepth,
    deliberation_root_id: deliberationRootId,
  })))

  return newTargetIds
}
