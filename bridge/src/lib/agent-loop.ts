type AgentFollowUpInput = {
  allowAgentToAgent: boolean
  isConclusion: boolean
  explicitTargetAgentIds: string[]
}

export function shouldEnqueueAgentFollowUp({
  allowAgentToAgent,
  isConclusion,
  explicitTargetAgentIds,
}: AgentFollowUpInput): boolean {
  return allowAgentToAgent && !isConclusion && explicitTargetAgentIds.length > 0
}
