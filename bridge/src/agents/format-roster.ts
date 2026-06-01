import type { ContextPacketV1 } from '@agentroom/shared'

/**
 * Render the room roster (Phase 10) for an agent prompt as reference DATA: the
 * other agents present, with their capability blurbs, so the agent can address a
 * peer deliberately (e.g. by @mention or a hand-off). Framed as data — the roster
 * never carries instructions.
 */
export function formatRosterForPrompt(roster?: ContextPacketV1['roster']): string | null {
  if (!roster || roster.length === 0) return null

  const lines = [
    'OTHER AGENTS IN THIS ROOM (reference data — you may address a peer by @slug or hand off work to them):',
  ]
  for (const agent of roster) {
    const blurb = agent.capabilities?.trim() ? ` — ${agent.capabilities.trim()}` : ''
    lines.push(`- ${agent.name} (@${agent.slug})${blurb}`)
  }
  return lines.join('\n')
}
