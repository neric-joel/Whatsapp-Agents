import type { DiscussionMode } from '@agentroom/shared'

interface TargetAgent {
  agent_id: string
}

export interface InitialAgentRunRow {
  room_id: string
  agent_id: string
  trigger_msg_id: string
  status: 'queued'
  round_index: number
  discussion_mode: DiscussionMode
  deliberation_depth: number
  deliberation_root_id: null
}

export function buildInitialAgentRunRows({
  roomId,
  messageId,
  targetAgents,
  roundIndex,
  discussionMode,
}: {
  roomId: string
  messageId: string
  targetAgents: TargetAgent[]
  roundIndex: number
  discussionMode: DiscussionMode
}): InitialAgentRunRow[] {
  return targetAgents.map((agent) => ({
    room_id: roomId,
    agent_id: agent.agent_id,
    trigger_msg_id: messageId,
    status: 'queued',
    round_index: roundIndex,
    discussion_mode: discussionMode,
    deliberation_depth: 0,
    deliberation_root_id: null,
  }))
}
