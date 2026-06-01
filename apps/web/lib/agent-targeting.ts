import type { ParsedMention } from './mention-parser'

interface TargetableAgent {
  agent_id: string
}

export function selectTargetAgents({
  allActive,
  mentions,
  replyMode,
  isDiscussionRequest,
}: {
  allActive: TargetableAgent[]
  mentions: ParsedMention[]
  replyMode: string
  isDiscussionRequest: boolean
}): { targetAgents: TargetableAgent[]; systemMessage?: string } {
  if (isDiscussionRequest) return { targetAgents: allActive }

  const hasEveryone = mentions.some((mention) => mention.type === 'everyone')
  if (hasEveryone) return { targetAgents: allActive }

  const mentionedAgentIds = new Set(
    mentions
      .filter((mention) => mention.type === 'agent' && mention.agent_id)
      .map((mention) => mention.agent_id as string),
  )

  if (mentionedAgentIds.size > 0) {
    return { targetAgents: allActive.filter((agent) => mentionedAgentIds.has(agent.agent_id)) }
  }

  if (replyMode === 'mentioned_only') {
    return {
      targetAgents: [],
      systemMessage: 'No agents were mentioned. Use @agent_slug or @everyone.',
    }
  }

  return { targetAgents: allActive }
}
