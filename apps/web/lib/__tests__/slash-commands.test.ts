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

  it('parses /recall with a query', () => {
    expect(parseSlashCommand('/recall deadline')).toEqual({ command: 'recall', query: 'deadline' })
  })

  it('parses /recall with no query', () => {
    expect(parseSlashCommand('/recall')).toEqual({ command: 'recall', query: '' })
  })

  it('is case-insensitive on the command', () => {
    expect(parseSlashCommand('/REMEMBER hi')?.command).toBe('remember')
  })

  it('does not match @mentions, plain text, or /discuss', () => {
    expect(parseSlashCommand('@claude_thinker hello')).toBeNull()
    expect(parseSlashCommand('just a normal message')).toBeNull()
    expect(parseSlashCommand('/discuss should we ship?')).toBeNull()
    expect(parseSlashCommand('/rememberance is not a command')).toBeNull()
  })
})
