import { describe, expect, it } from 'vitest'
import {
  buildDiscussionPhasePrompt,
  nextDiscussionPhase,
  parseDiscussionCommand,
  parseDiscussionRequest,
} from '@agentroom/shared'

describe('discussion slash command', () => {
  it('parses /discuss prompts', () => {
    expect(parseDiscussionCommand('/discuss solve 3x + 7 = 22')).toEqual({
      command: 'discuss',
      prompt: 'solve 3x + 7 = 22',
    })
    expect(parseDiscussionCommand('solve normally')).toBeNull()
  })

  it('treats @everyone questions as discussion requests', () => {
    expect(parseDiscussionRequest('@everyone Are humans innately good or evil?')).toEqual({
      command: 'discuss',
      prompt: 'Are humans innately good or evil?',
    })
    expect(parseDiscussionRequest('@everyone hi guys')).toBeNull()
  })

  it('builds critique and consensus prompts', () => {
    expect(nextDiscussionPhase('individual')).toBe('critique')
    expect(buildDiscussionPhasePrompt('individual', 'math')).toContain('not a full final answer')
    expect(buildDiscussionPhasePrompt('critique', 'math')).toContain('Do not restart as a solo solution')
    expect(buildDiscussionPhasePrompt('consensus', 'math')).toContain('one clear final consensus')
  })
})
