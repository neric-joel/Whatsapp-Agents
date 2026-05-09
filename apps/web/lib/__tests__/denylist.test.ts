import { describe, it, expect } from 'vitest'
import { isDeniedCommand } from '../../../../bridge/src/lib/denylist'

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
})
