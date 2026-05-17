import type { SupabaseClient } from '@supabase/supabase-js'
import { shouldEnqueueAgentFollowUp } from './agent-loop.js'
import { parseMentions } from './mention-parser.js'

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

export async function maybeScheduleAgentMentionFollowUps({
  supabase,
  roomId,
  sourceAgentId,
  sourceMessageId,
  replyContent,
  roundIndex,
  isConclusion,
}: {
  supabase: SupabaseClient
  roomId: string
  sourceAgentId: string
  sourceMessageId: string
  replyContent: string
  roundIndex: number
  isConclusion: boolean
}): Promise<string[]> {
  const { data: room } = await supabase
    .from('rooms')
    .select('allow_agent_to_agent, max_agent_rounds')
    .eq('id', roomId)
    .single()

  const allowAgentToAgent = Boolean((room as { allow_agent_to_agent?: boolean } | null)?.allow_agent_to_agent)
  const maxRounds = (room as { max_agent_rounds?: number } | null)?.max_agent_rounds ?? 0
  const nextRoundIndex = roundIndex + 1
  if (maxRounds > 0 && nextRoundIndex >= maxRounds) return []

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
  const mentionedEveryone = mentions.some((mention) => mention.type === 'everyone')
  const explicitTargetIds = mentionedEveryone
    ? members.map((member) => member.agent_id)
    : mentions
        .filter((mention) => mention.type === 'agent' && mention.agent_id)
        .map((mention) => mention.agent_id as string)

  const targetIds = [...new Set(explicitTargetIds)].filter((agentId) => agentId !== sourceAgentId)

  if (!shouldEnqueueAgentFollowUp({
    allowAgentToAgent,
    isConclusion,
    explicitTargetAgentIds: targetIds,
  })) {
    return []
  }

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
  })))

  return newTargetIds
}
