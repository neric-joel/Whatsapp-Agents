import { describe, expect, it } from 'vitest'

import { selectTargetAgents } from '../agent-targeting'

const agents = [{ agent_id: 'claude' }, { agent_id: 'codex' }]

describe('selectTargetAgents', () => {
  it('targets only explicitly mentioned agents even when the room normally fans out to everyone', () => {
    expect(
      selectTargetAgents({
        allActive: agents,
        mentions: [
          { type: 'agent', agent_id: 'codex', slug: 'codex_builder', raw: '@codex_builder' },
        ],
        replyMode: 'everyone',
        isDiscussionRequest: false,
      }).targetAgents,
    ).toEqual([{ agent_id: 'codex' }])
  })

  it('@everyone targets all active agents', () => {
    expect(
      selectTargetAgents({
        allActive: agents,
        mentions: [{ type: 'everyone', raw: '@everyone' }],
        replyMode: 'mentioned_only',
        isDiscussionRequest: false,
      }).targetAgents,
    ).toEqual(agents)
  })

  it('discussion requests intentionally target all active agents', () => {
    expect(
      selectTargetAgents({
        allActive: agents,
        mentions: [],
        replyMode: 'mentioned_only',
        isDiscussionRequest: true,
      }).targetAgents,
    ).toEqual(agents)
  })

  it('keeps mentioned-only rooms quiet when no valid mention exists', () => {
    const result = selectTargetAgents({
      allActive: agents,
      mentions: [],
      replyMode: 'mentioned_only',
      isDiscussionRequest: false,
    })

    expect(result.targetAgents).toEqual([])
    expect(result.systemMessage).toContain('No agents were mentioned')
  })
})
