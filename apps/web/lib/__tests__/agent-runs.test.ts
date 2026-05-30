import { describe, expect, it } from 'vitest'

import { buildInitialAgentRunRows } from '../agent-runs'

const agents = [{ agent_id: 'agent-1' }, { agent_id: 'agent-2' }]

describe('buildInitialAgentRunRows', () => {
  it('user message in independent mode creates normal initial runs with depth 0', () => {
    expect(
      buildInitialAgentRunRows({
        roomId: 'room-1',
        messageId: 'message-1',
        targetAgents: agents,
        roundIndex: 0,
        discussionMode: 'independent',
      }),
    ).toEqual([
      {
        room_id: 'room-1',
        agent_id: 'agent-1',
        trigger_msg_id: 'message-1',
        status: 'queued',
        round_index: 0,
        discussion_mode: 'independent',
        deliberation_depth: 0,
        deliberation_root_id: null,
      },
      {
        room_id: 'room-1',
        agent_id: 'agent-2',
        trigger_msg_id: 'message-1',
        status: 'queued',
        round_index: 0,
        discussion_mode: 'independent',
        deliberation_depth: 0,
        deliberation_root_id: null,
      },
    ])
  })

  it('user message in tag_turns mode stamps initial runs with tag_turns', () => {
    expect(
      buildInitialAgentRunRows({
        roomId: 'room-1',
        messageId: 'message-1',
        targetAgents: agents,
        roundIndex: 0,
        discussionMode: 'tag_turns',
      }),
    ).toMatchObject([
      {
        agent_id: 'agent-1',
        discussion_mode: 'tag_turns',
        deliberation_depth: 0,
        deliberation_root_id: null,
      },
      {
        agent_id: 'agent-2',
        discussion_mode: 'tag_turns',
        deliberation_depth: 0,
        deliberation_root_id: null,
      },
    ])
  })
})
