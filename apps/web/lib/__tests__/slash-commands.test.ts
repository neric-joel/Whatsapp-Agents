import { describe, expect, it } from 'vitest'

import { parseSlashCommand } from '../slash-commands'

describe('parseSlashCommand', () => {
  it('parses /remember with text', () => {
    expect(parseSlashCommand('/remember the deadline is Friday')).toEqual({
      command: 'remember',
      text: 'the deadline is Friday',
      global: false,
    })
  })

  it('parses /remember --global', () => {
    expect(parseSlashCommand('/remember --global I prefer concise answers')).toEqual({
      command: 'remember',
      text: 'I prefer concise answers',
      global: true,
    })
  })

  it('parses --global anywhere in the remember body', () => {
    const r = parseSlashCommand('/remember keep it short --global')
    expect(r).toEqual({ command: 'remember', text: 'keep it short', global: true })
  })

  it('strips every --global occurrence (no literal flag left in the note)', () => {
    const r = parseSlashCommand('/remember --global note --global here')
    expect(r).toEqual({ command: 'remember', text: 'note here', global: true })
  })

  it('parses /recall with a query', () => {
    expect(parseSlashCommand('/recall deadline')).toEqual({ command: 'recall', query: 'deadline' })
  })

  it('parses /recall with no query', () => {
    expect(parseSlashCommand('/recall')).toEqual({ command: 'recall', query: '' })
  })

  it('is case-insensitive on the command', () => {
    expect(parseSlashCommand('/REMEMBER hi')?.command).toBe('remember')
  })

  it('parses /handoff @agent <task>', () => {
    expect(parseSlashCommand('/handoff @reviewer please check the auth flow')).toEqual({
      command: 'handoff',
      toSlug: 'reviewer',
      task: 'please check the auth flow',
    })
  })

  it('parses /handoff @agent with no task', () => {
    expect(parseSlashCommand('/handoff @reviewer')).toEqual({
      command: 'handoff',
      toSlug: 'reviewer',
      task: '',
    })
  })

  it('parses /handoff with no target (empty slug → caller validates)', () => {
    expect(parseSlashCommand('/handoff do something')).toEqual({
      command: 'handoff',
      toSlug: '',
      task: '',
    })
  })

  it('parses /agents', () => {
    expect(parseSlashCommand('/agents')).toEqual({ command: 'agents' })
    expect(parseSlashCommand('/agents list')).toEqual({ command: 'agents' })
  })

  it('parses /help and /commands (alias) to a help command', () => {
    expect(parseSlashCommand('/help')).toEqual({ command: 'help' })
    expect(parseSlashCommand('/commands')).toEqual({ command: 'help' })
  })

  it('parses /pin and /reset', () => {
    expect(parseSlashCommand('/pin')).toEqual({ command: 'pin' })
    expect(parseSlashCommand('/reset')).toEqual({ command: 'reset' })
  })

  it('returns an unknown marker for unregistered slash commands (friendly rejection)', () => {
    expect(parseSlashCommand('/foo bar')).toEqual({ command: 'unknown', name: 'foo' })
    // a superset/typo of a real command is unknown, not silently sent
    expect(parseSlashCommand('/rememberance is not a command')).toEqual({
      command: 'unknown',
      name: 'rememberance',
    })
    expect(parseSlashCommand('/agentsfoo')).toEqual({ command: 'unknown', name: 'agentsfoo' })
  })

  it('does not match @mentions, plain text, or /discuss', () => {
    expect(parseSlashCommand('@claude_thinker hello')).toBeNull()
    expect(parseSlashCommand('just a normal message')).toBeNull()
    expect(parseSlashCommand('/discuss should we ship?')).toBeNull()
    // a stray leading slash that is not command-like flows through as a message
    expect(parseSlashCommand('/123 not a command')).toBeNull()
  })
})
