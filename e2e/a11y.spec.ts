import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * Accessibility (WCAG 2.1 A/AA) scan via axe-core. Local app — no login — so we scan
 * the real surfaces: the room page and the Connections screen. We fail on any
 * `serious` or `critical` violation (the WCAG-AA-blocking severities).
 */

const BLOCKING_IMPACTS = new Set(['serious', 'critical'])
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function scan(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''))
}

test.describe('accessibility (axe)', () => {
  test('the room page has no serious or critical WCAG violations', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const blocking = await scan(page)
    expect(blocking, blocking.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual([])
  })

  test('the Connections screen has no serious or critical WCAG violations', async ({ page }) => {
    await page.goto('/connections')
    await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible()
    await expect(page.getByText('Detected on your machine')).toBeVisible({ timeout: 20_000 })

    const blocking = await scan(page)
    expect(blocking, blocking.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual([])
  })
})
