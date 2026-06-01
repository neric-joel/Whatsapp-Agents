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
})
