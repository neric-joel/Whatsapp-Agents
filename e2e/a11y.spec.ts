import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * Automated accessibility (WCAG 2.1 A/AA) scan via axe-core.
 *
 * Runs deterministically in CI with only the web server (dummy Supabase env) —
 * `/auth` is the page that renders without a live session (AuthGuard redirects
 * the app pages). The in-app journeys are gated on E2E_LIVE; when that's set,
 * the room page is scanned too. We fail on any `serious` or `critical`
 * violation (the WCAG-AA-blocking severities); `minor`/`moderate` are reported
 * but not gated, matching the Phase 4 DoD ("0 critical axe violations").
 */

const BLOCKING_IMPACTS = new Set(['serious', 'critical'])
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const IS_LIVE = Boolean(process.env.E2E_LIVE)
const E2E_EMAIL = process.env.E2E_EMAIL ?? 'e2e-test@agentroom.local'
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'testpassword1234'

// The 7 shipped themes (globals.css `:root[data-agentroom-theme=…]`).
const THEMES = [
  'light-modern',
  'github-light',
  'solarized-light',
  'dark-modern',
  'github-dark',
  'one-dark-pro',
  'dracula',
] as const

async function signInToRoom(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(E2E_EMAIL)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

test.describe('accessibility (axe)', () => {
  test('auth page has no serious or critical WCAG violations', async ({ page }) => {
    await page.goto('/auth')
    await expect(page.getByRole('heading', { name: 'AgentRoom' })).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()

    const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''))
    // Surface a readable summary in the report when something fails.
    expect(blocking, blocking.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual([])
  })

  test('auth page in Sign Up mode has no serious or critical violations', async ({ page }) => {
    await page.goto('/auth')
    await page.getByRole('tab', { name: 'Sign Up' }).click()
    await expect(page.locator('button[type="submit"]')).toHaveText('Create account')

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''))
    expect(blocking, blocking.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual([])
  })

  // Authenticated room page — gated on E2E_LIVE (needs a seeded Supabase + a
  // signed-in session). This closes the Phase 4 DoD "axe on authenticated pages"
  // item that the auth-only scans above could not cover.
  test('authenticated room page has no serious or critical WCAG violations', async ({ page }) => {
    if (!IS_LIVE) {
      test.skip(true, 'Skipped: set E2E_LIVE=1 and provide a seeded Supabase instance to run.')
    }
    await page.goto('/auth')
    await page.getByLabel('Email').fill(E2E_EMAIL)
    await page.getByLabel('Password').fill(E2E_PASSWORD)
    await page.locator('button[type="submit"]').click()
    // Land in a room (AuthGuard → "/" → first room).
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''))
    expect(blocking, blocking.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual([])
  })

  // WS-UX: the authenticated room page must be WCAG-AA clean on EVERY theme (closes the
  // ADR-0009 "per-theme authed a11y" gate). Each theme is applied via the same data
  // attribute the ThemeSwitcher sets, then re-scanned.
  test('authenticated room page passes axe on all 7 themes', async ({ page }) => {
    if (!IS_LIVE) test.skip(true, 'Set E2E_LIVE=1 with a seeded Supabase instance to run.')
    await signInToRoom(page)

    const failures: string[] = []
    for (const theme of THEMES) {
      await page.evaluate((t) => {
        // runs in the browser context; globalThis avoids a Node no-undef lint error
        globalThis.document.documentElement.dataset.agentroomTheme = t
      }, theme)
      await page.waitForTimeout(120) // let CSS vars repaint
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''))
      for (const v of blocking) failures.push(`[${theme}] ${v.impact}: ${v.id} — ${v.help}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  })

  // WS-UX: the new Settings → Providers surface (WS2) must also be a11y-clean.
  test('authenticated Settings page has no serious or critical WCAG violations', async ({
    page,
  }) => {
    if (!IS_LIVE) test.skip(true, 'Set E2E_LIVE=1 with a seeded Supabase instance to run.')
    await signInToRoom(page)
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Providers & API keys' })).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''))
    expect(blocking, blocking.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual([])
  })
})
