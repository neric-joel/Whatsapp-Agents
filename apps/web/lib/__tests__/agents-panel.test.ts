import { describe, expect, it } from 'vitest'

import { mapMembersToAgentRows, type MemberRow } from '../agents-panel'

// The exact shape GET /api/rooms/[roomId]/members returns (formatMember): the agent join
// is `agent` (singular), plus a member-row `id`.
function member(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    id: 'mem-1',
    agent_id: 'agent-1',
    member_type: 'agent',
    muted: false,
    reply_enabled: true,
    agent: {
      id: 'agent-1',
      name: 'Claude',
      slug: 'claude',
      provider: 'profile-xyz',
      adapter_type: 'cli',
      is_active: true,
    },
    last_run_status: null,
    ...overrides,
  }
}

describe('mapMembersToAgentRows (#84 regression)', () => {
  it('renders active agents from the API `agent` (singular) field', () => {
    // Regression: reading `m.agents` (plural) here returned [] and the panel showed
    // "No agents in this room yet" even with active agents in the room.
    const rows = mapMembersToAgentRows([member()])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.agent?.name).toBe('Claude')
    expect(rows[0]!.member_id).toBe('mem-1') // needed for the mute PATCH
    expect(rows[0]!.muted).toBe(false)
  })

  it('keeps two distinct active agents (does not silently drop members)', () => {
    const rows = mapMembersToAgentRows([
      member(),
      member({
        id: 'mem-2',
        agent_id: 'agent-2',
        agent: {
          id: 'agent-2',
          name: 'Codex',
          slug: 'codex',
          provider: 'p2',
          adapter_type: 'cli',
          is_active: true,
        },
      }),
    ])
    expect(rows.map((r) => r.agent?.slug)).toEqual(['claude', 'codex'])
  })

  it('reflects muted state and carries the member id for unmuting', () => {
    const rows = mapMembersToAgentRows([member({ muted: true })])
    expect(rows[0]!.muted).toBe(true)
    expect(rows[0]!.member_id).toBe('mem-1')
  })

  it('filters out inactive (disabled) agents', () => {
    const rows = mapMembersToAgentRows([
      member({
        agent: {
          id: 'agent-1',
          name: 'Old',
          slug: 'old',
          provider: null,
          adapter_type: 'cli',
          is_active: false,
        },
      }),
    ])
    expect(rows).toHaveLength(0)
  })
})
