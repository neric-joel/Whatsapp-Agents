import { isDeniedCommand } from '@agentroom/shared'
import { describe, expect, it } from 'vitest'

describe('isDeniedCommand', () => {
  it('blocks rm -rf', () => {
    expect(isDeniedCommand('rm -rf /home')).toBe(true)
  })

  it('allows ls -la', () => {
    expect(isDeniedCommand('ls -la')).toBe(false)
  })

  it('allows echo hello', () => {
    expect(isDeniedCommand('echo hello')).toBe(false)
  })

  it('blocks DROP TABLE', () => {
    expect(isDeniedCommand('DROP TABLE users')).toBe(true)
  })

  it('blocks drop table (case-insensitive)', () => {
    expect(isDeniedCommand('drop table users')).toBe(true)
  })

  it('blocks spaced recursive rm flags', () => {
    expect(isDeniedCommand('rm -r -f /tmp/project')).toBe(true)
  })

  it('blocks unicode-normalized destructive commands', () => {
    expect(isDeniedCommand('ｒｍ -rf /tmp/project')).toBe(true)
  })

  it('blocks truncate table', () => {
    expect(isDeniedCommand('TRUNCATE TABLE users')).toBe(true)
  })

  it('blocks delete from without where', () => {
    expect(isDeniedCommand('DELETE FROM users')).toBe(true)
  })

  it('allows delete from with where', () => {
    expect(isDeniedCommand('DELETE FROM users WHERE id = 1')).toBe(false)
  })
})
