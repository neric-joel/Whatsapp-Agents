import type { RoomAgentMember } from '@agentroom/shared'

export interface MentionAgent {
  id: string
  slug: string
  name: string
}

export function mapMembersToMentionAgents(members: RoomAgentMember[]): MentionAgent[] {
  return members
    .filter((member) => member.member_type === 'agent' && !member.muted && member.agent.is_active)
    .map((member) => ({
      id: member.agent.id,
      slug: member.agent.slug,
      name: member.agent.name,
    }))
}
