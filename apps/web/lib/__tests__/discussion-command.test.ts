import {
  buildDiscussionStagePrompt,
  nextDiscussionStage,
  parseDiscussionCommand,
  parseDiscussionRequest,
} from '@agentroom/shared'
import { describe, expect, it } from 'vitest'

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

  it('drives the team-collaboration phase machine (ADR-0011)', () => {
    // discuss: plan -> execute -> integrate -> converge (challenge present skips dissent)
    expect(nextDiscussionStage('discuss', 'plan', false)).toEqual({
      phase: 'execute',
      target: 'all',
    })
    expect(nextDiscussionStage('discuss', 'integrate', true)).toEqual({
      phase: 'converge',
      target: 'coordinator',
    })
    expect(buildDiscussionStagePrompt('discuss', 'plan', 'math')).toContain(
      'COMPLEMENTARY sub-tasks',
    )
    expect(buildDiscussionStagePrompt('discuss', 'converge', 'math')).toContain('Contributions:')
    // debate is a genuinely different (adversarial) machine
    expect(nextDiscussionStage('debate', 'assign', false)).toEqual({
      phase: 'argue',
      target: 'all',
    })
    expect(buildDiscussionStagePrompt('debate', 'adjudicate', 'math')).toContain('Do NOT merge')
  })
})
