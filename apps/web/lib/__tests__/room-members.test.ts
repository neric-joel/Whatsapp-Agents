import type { RoomAgentMember } from '@agentroom/shared'
import { describe, expect, it } from 'vitest'

import { mapMembersToMentionAgents } from '../room-members'

function member(overrides: Partial<RoomAgentMember> = {}): RoomAgentMember {
  return {
    id: 'member-1',
    room_id: 'room-1',
    agent_id: 'agent-1',
    member_type: 'agent',
    reply_enabled: true,
    muted: false,
    joined_at: '2026-01-01T00:00:00.000Z',
    agent: {
      id: 'agent-1',
      name: 'Claude',
      slug: 'claude',
      provider: 'mock',
      adapter_type: 'mock',
      is_active: true,
    },
    last_run_status: null,
    ...overrides,
  }
}

describe('mapMembersToMentionAgents', () => {
  it('uses the members API `agent` field for mention autocomplete', () => {
    const rows = mapMembersToMentionAgents([member()])

    expect(rows).toEqual([{ id: 'agent-1', slug: 'claude', name: 'Claude' }])
  })

  it('does not expose the old plural join spelling at type level', () => {
    const row = member()
    // @ts-expect-error RoomAgentMember intentionally has `agent`, not `agents`.
    expect(row.agents).toBeUndefined()
  })

  it('filters muted and inactive agents', () => {
    const rows = mapMembersToMentionAgents([
      member({ id: 'muted', muted: true }),
      member({
        id: 'inactive',
        agent_id: 'agent-2',
        agent: {
          id: 'agent-2',
          name: 'Codex',
          slug: 'codex',
          provider: 'mock',
          adapter_type: 'mock',
          is_active: false,
        },
      }),
    ])

    expect(rows).toEqual([])
  })
})
