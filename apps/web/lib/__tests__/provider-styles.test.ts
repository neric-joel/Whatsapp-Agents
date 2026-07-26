import { describe, expect, it } from 'vitest'

import { getProviderStyle, PROVIDER_STYLES } from '../provider-styles'

describe('provider styles', () => {
  it('returns provider-specific styling and falls back to mock styling', () => {
    expect(getProviderStyle('codex_cli')).toBe(PROVIDER_STYLES.codex_cli)
    expect(getProviderStyle('claude_code')).toBe(PROVIDER_STYLES.claude_code)
    expect(getProviderStyle('unknown')).toBe(PROVIDER_STYLES.mock)
    expect(getProviderStyle(null)).toBe(PROVIDER_STYLES.mock)
  })

  it('uses theme-aware bubble classes instead of hard-coded light backgrounds', () => {
    expect(PROVIDER_STYLES.codex_cli.bubble).toBe('agent-provider-bubble agent-provider-codex-cli')
    expect(PROVIDER_STYLES.claude_code.bubble).toBe(
      'agent-provider-bubble agent-provider-claude-code',
    )
    expect(PROVIDER_STYLES.mock.bubble).toBe('agent-provider-bubble agent-provider-mock')
  })
})
