import { describe, expect, it } from 'vitest'

import { userVisibleContent } from '../message-display'

const KICKOFF_PROMPT = 'TEAM DISCUSSION — plan & decompose (you are the coordinator)…'

describe('userVisibleContent (original_input, v1.5.0+)', () => {
  it('prefers the literal typed text when the server stored it', () => {
    expect(
      userVisibleContent(KICKOFF_PROMPT, 'user', {
        discussion: {
          enabled: true,
          command: 'discuss',
          original_prompt: 'should we ship?',
          original_input: '@everyone should we ship?',
        },
      }),
    ).toBe('@everyone should we ship?')
  })

  it('ignores a non-string original_input and falls back to the rebuild', () => {
    expect(
      userVisibleContent(KICKOFF_PROMPT, 'user', {
        discussion: {
          enabled: true,
          command: 'discuss',
          original_prompt: 'x',
          original_input: 42,
        },
      }),
    ).toBe('/discuss x')
  })
})

describe('userVisibleContent', () => {
  it('rebuilds the typed command for a /discuss kickoff user bubble', () => {
    expect(
      userVisibleContent(KICKOFF_PROMPT, 'user', {
        discussion: {
          enabled: true,
          command: 'discuss',
          phase: 'plan',
          original_prompt: 'Should a local-first app use SQLite or Postgres?',
        },
      }),
    ).toBe('/discuss Should a local-first app use SQLite or Postgres?')
  })

  it('rebuilds /debate kickoffs too', () => {
    expect(
      userVisibleContent(KICKOFF_PROMPT, 'user', {
        discussion: { enabled: true, command: 'debate', original_prompt: 'tabs vs spaces' },
      }),
    ).toBe('/debate tabs vs spaces')
  })

  it('never rewrites agent messages, even when they carry discussion metadata', () => {
    expect(
      userVisibleContent('the agent reply', 'agent', {
        discussion: { enabled: true, command: 'discuss', original_prompt: 'x' },
      }),
    ).toBe('the agent reply')
  })

  it('leaves plain user messages untouched', () => {
    expect(userVisibleContent('hello', 'user', {})).toBe('hello')
    expect(userVisibleContent('hello', 'user', null)).toBe('hello')
  })

  it('falls back to stored content on malformed discussion metadata', () => {
    expect(userVisibleContent('stored', 'user', { discussion: 'yes' })).toBe('stored')
    expect(userVisibleContent('stored', 'user', { discussion: { enabled: true } })).toBe('stored')
    expect(
      userVisibleContent('stored', 'user', {
        discussion: { enabled: 'true', command: 'discuss', original_prompt: 'x' },
      }),
    ).toBe('stored')
    expect(userVisibleContent('stored', 'user', { discussion: [1, 2] })).toBe('stored')
  })
})
