export const APP_THEMES = [
  { id: 'light-modern', label: 'Light Modern' },
  { id: 'github-light', label: 'GitHub Light' },
  { id: 'solarized-light', label: 'Solarized Light' },
  { id: 'dark-modern', label: 'Dark Modern' },
  { id: 'github-dark', label: 'GitHub Dark' },
  { id: 'one-dark-pro', label: 'One Dark Pro' },
  { id: 'dracula', label: 'Dracula' },
] as const

export type AppThemeId = (typeof APP_THEMES)[number]['id']

export const DEFAULT_APP_THEME: AppThemeId = 'light-modern'

export function isAppThemeId(value: string | null): value is AppThemeId {
  return APP_THEMES.some((theme) => theme.id === value)
}
