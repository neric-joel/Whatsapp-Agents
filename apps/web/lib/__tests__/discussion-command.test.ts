import { describe, expect, it } from 'vitest'
import { buildDiscussionPhasePrompt, nextDiscussionPhase, parseDiscussionCommand } from '@agentroom/shared'

describe('discussion slash command', () => {
  it('parses /discuss prompts', () => {
    expect(parseDiscussionCommand('/discuss solve 3x + 7 = 22')).toEqual({
      command: 'discuss',
      prompt: 'solve 3x + 7 = 22',
    })
    expect(parseDiscussionCommand('solve normally')).toBeNull()
  })

  it('builds critique and consensus prompts', () => {
    expect(nextDiscussionPhase('individual')).toBe('critique')
    expect(buildDiscussionPhasePrompt('critique', 'math')).toContain('Do not just solve alone')
    expect(buildDiscussionPhasePrompt('consensus', 'math')).toContain('one clear final consensus')
  })
})
