/**
 * Pure mapping from the GET /api/rooms/[roomId]/members payload to the rows AgentsPanel
 * renders. Extracted so it can be unit-tested without a DOM.
 *
 * Regression guard (#84): the members API joins the agent as `agent` (singular). A prior
 * version of AgentsPanel read `m.agents` (plural) — always undefined — so its
 * `m.agents?.is_active` filter dropped every member and the panel always showed
 * "No agents in this room yet" even when the room had active agents.
 */

export interface AgentInfo {
  id: string
  name: string
  slug: string
  provider: string | null
  adapter_type: string | null
  is_active: boolean
}

export interface MemberRow {
  id?: string | null
  agent_id?: string | null
  member_type?: string | null
  muted?: boolean | null
  reply_enabled?: boolean | null
  agent?: AgentInfo | null
  last_run_status?: string | null
}

export interface AgentRow {
  member_id: string
  agent_id: string
  muted: boolean
  reply_enabled: boolean
  agent: AgentInfo | null
  last_run_status: string | null
}

/** Keep only active agents and project the member into a render row. */
export function mapMembersToAgentRows(members: MemberRow[]): AgentRow[] {
  return members
    .filter((m) => m.agent?.is_active)
    .map((m) => ({
      member_id: m.id ?? '',
      agent_id: m.agent_id ?? m.agent!.id,
      muted: m.muted ?? false,
      reply_enabled: m.reply_enabled ?? true,
      agent: m.agent ?? null,
      last_run_status: m.last_run_status ?? null,
    }))
}
