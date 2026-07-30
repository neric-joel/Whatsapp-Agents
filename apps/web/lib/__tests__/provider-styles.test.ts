import { describe, expect, it } from 'vitest'

import { getProviderStyle, PROVIDER_STYLES } from '../provider-styles'

// Fields whose literal colours are deliberate provider identity (#97): the avatar
// chip, the presence dot, the agent name, and the run-card glow. The avatar hexes
// are pinned to audited WCAG ratios, so they stay hard-coded on purpose. Every
// other field lands on the bubble element, so anything new defaults to the
// theme-token side of this line.
const ACCENT_FIELDS = new Set(['avatar', 'nameColor', 'dot', 'glow'])

// A hex or rgb() colour written straight into a class name. No word boundary
// before rgb(: Tailwind's arbitrary values join on underscores, so the glow
// utilities read `shadow-[0_0_14px_rgba(...)]`.
const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|rgba?\(/i

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

  // The bubble's background, text, and border come from the .agent-provider-bubble
  // rules in globals.css. A literal colour utility on that same element renders
  // correctly only by specificity accident: the theme rule wins today because an
  // attribute selector plus a class outranks a lone utility class. Let the utility
  // win instead -- a Tailwind layer reorder, an !important, a refactor that moves
  // the theme rule -- and every agent reply becomes near-black text on a near-black
  // bubble in all four dark themes.
  it('paints the bubble surface from theme tokens, never a literal colour', () => {
    for (const [provider, style] of Object.entries(PROVIDER_STYLES)) {
      const bubbleSurface = Object.entries(style)
        .filter(([field]) => !ACCENT_FIELDS.has(field))
        .map(([, classes]) => classes)
        .join(' ')

      expect(bubbleSurface, `${provider} bubble surface`).not.toMatch(LITERAL_COLOR)
    }
  })

  it('keeps the per-provider accent colours that carry provider identity', () => {
    for (const [provider, style] of Object.entries(PROVIDER_STYLES)) {
      for (const field of ACCENT_FIELDS) {
        expect(style[field as keyof typeof style], `${provider} ${field}`).toMatch(LITERAL_COLOR)
      }
    }
  })
})
