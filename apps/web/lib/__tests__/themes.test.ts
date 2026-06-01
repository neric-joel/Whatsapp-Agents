import { describe, expect, it } from 'vitest'

import { APP_THEMES, DEFAULT_APP_THEME, isAppThemeId } from '../themes'

describe('app themes', () => {
  it('offers light and dark VS Code inspired themes', () => {
    expect(DEFAULT_APP_THEME).toBe('light-modern')
    expect(APP_THEMES.map((theme) => theme.id)).toContain('dark-modern')
    expect(APP_THEMES.map((theme) => theme.id)).toContain('github-light')
    expect(APP_THEMES.map((theme) => theme.id)).toContain('dracula')
  })

  it('validates theme ids', () => {
    expect(isAppThemeId('one-dark-pro')).toBe(true)
    expect(isAppThemeId('not-a-theme')).toBe(false)
    expect(isAppThemeId(null)).toBe(false)
  })
})
