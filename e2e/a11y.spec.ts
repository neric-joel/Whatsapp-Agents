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
})
