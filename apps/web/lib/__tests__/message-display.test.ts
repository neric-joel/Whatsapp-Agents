import { buildDiscussionStagePrompt } from '@agentroom/shared'
import { describe, expect, it } from 'vitest'

import { hasMeaningfulUpdate, userVisibleContent } from '../message-display'

const KICKOFF_PROMPT = buildDiscussionStagePrompt('discuss', 'plan', 'should we ship?')

describe('userVisibleContent (original_input, v1.5.0+)', () => {
  it('prefers the literal typed text when the server stored it', () => {
    expect(
      userVisibleContent(KICKOFF_PROMPT, 'user', {
        discussion: {
          enabled: true,
          command: 'discuss',
          phase: 'plan',
          original_prompt: 'should we ship?',
          original_input: '@everyone should we ship?',
        },
      }),
    ).toBe('@everyone should we ship?')
  })

  it('ignores a non-string original_input and falls back to the rebuild', () => {
    const prompt = 'x'
    expect(
      userVisibleContent(buildDiscussionStagePrompt('discuss', 'plan', prompt), 'user', {
        discussion: {
          enabled: true,
          command: 'discuss',
          phase: 'plan',
          original_prompt: prompt,
          original_input: 42,
        },
      }),
    ).toBe('/discuss x')
  })
})

describe('userVisibleContent', () => {
  it('rebuilds the typed command for a /discuss kickoff user bubble', () => {
    const prompt = 'Should a local-first app use SQLite or Postgres?'
    expect(
      userVisibleContent(buildDiscussionStagePrompt('discuss', 'plan', prompt), 'user', {
        discussion: {
          enabled: true,
          command: 'discuss',
          phase: 'plan',
          original_prompt: prompt,
        },
      }),
    ).toBe('/discuss Should a local-first app use SQLite or Postgres?')
  })

  it('rebuilds /debate kickoffs too', () => {
    expect(
      userVisibleContent(buildDiscussionStagePrompt('debate', 'assign', 'tabs vs spaces'), 'user', {
        discussion: {
          enabled: true,
          command: 'debate',
          phase: 'assign',
          original_prompt: 'tabs vs spaces',
        },
      }),
    ).toBe('/debate tabs vs spaces')
  })

  it('keeps edited discussion kickoff content instead of rewriting to original_input', () => {
    expect(
      userVisibleContent('edited question', 'user', {
        discussion: {
          enabled: true,
          command: 'discuss',
          phase: 'plan',
          original_prompt: 'should we ship?',
          original_input: '/discuss should we ship?',
        },
      }),
    ).toBe('edited question')
  })

  it('uses updated_at as a legacy divergence signal when the server prompt cannot be rebuilt', () => {
    expect(
      userVisibleContent(
        'edited legacy question',
        'user',
        {
          discussion: {
            enabled: true,
            command: 'discuss',
            original_prompt: 'should we ship?',
            original_input: '/discuss should we ship?',
          },
        },
        {
          createdAt: '2026-07-24T10:00:00.000Z',
          updatedAt: '2026-07-24T10:00:02.000Z',
        },
      ),
    ).toBe('edited legacy question')
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

describe('hasMeaningfulUpdate', () => {
  it('allows a small insert/update timestamp epsilon', () => {
    expect(hasMeaningfulUpdate('2026-07-24T10:00:00.000Z', '2026-07-24T10:00:00.500Z')).toBe(false)
    expect(hasMeaningfulUpdate('2026-07-24T10:00:00.000Z', '2026-07-24T10:00:02.000Z')).toBe(true)
  })
})
