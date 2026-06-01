'use client'

import { useEffect, useState } from 'react'

import { APP_THEMES, type AppThemeId, DEFAULT_APP_THEME, isAppThemeId } from '@/lib/themes'

const STORAGE_KEY = 'agentroom-theme'

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<AppThemeId>(DEFAULT_APP_THEME)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    const nextTheme = isAppThemeId(stored) ? stored : DEFAULT_APP_THEME
    setTheme(nextTheme)
    document.documentElement.dataset.agentroomTheme = nextTheme
  }, [])

  function updateTheme(value: string) {
    if (!isAppThemeId(value)) return
    setTheme(value)
    document.documentElement.dataset.agentroomTheme = value
    window.localStorage.setItem(STORAGE_KEY, value)
  }

  return (
    <label className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
      Theme
      <select
        aria-label="Theme"
        value={theme}
        onChange={(event) => updateTheme(event.target.value)}
        className="h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 text-xs text-[var(--text)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)]"
      >
        {APP_THEMES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  )
}
