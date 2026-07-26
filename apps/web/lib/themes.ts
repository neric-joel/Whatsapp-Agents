export const APP_THEMES = [
  { id: 'light-modern', label: 'Light Modern', isDark: false },
  { id: 'github-light', label: 'GitHub Light', isDark: false },
  { id: 'solarized-light', label: 'Solarized Light', isDark: false },
  { id: 'dark-modern', label: 'Dark Modern', isDark: true },
  { id: 'github-dark', label: 'GitHub Dark', isDark: true },
  { id: 'one-dark-pro', label: 'One Dark Pro', isDark: true },
  { id: 'dracula', label: 'Dracula', isDark: true },
] as const

export type AppThemeId = (typeof APP_THEMES)[number]['id']

export const DEFAULT_APP_THEME: AppThemeId = 'light-modern'
export const THEME_STORAGE_KEY = 'agentroom-theme'

export function isAppThemeId(value: string | null): value is AppThemeId {
  return APP_THEMES.some((theme) => theme.id === value)
}
