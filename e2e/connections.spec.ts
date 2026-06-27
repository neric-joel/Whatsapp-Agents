/**
 * connections.spec.ts — the Connections screen (the headline local feature).
 *
 * Only needs the web server. Detection runs server-side; on a CI runner the catalog
 * CLIs won't be installed, so they render as "not found" — the point here is that the
 * screen detects + lists the known CLIs and offers a bring-your-own form, regardless
 * of what's installed.
 */
import { expect, test } from '@playwright/test'

test.describe('Connections screen', () => {
  test('lists the known CLIs and the bring-your-own form', async ({ page }) => {
    await page.goto('/connections')

    await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible()
    await expect(page.getByText('Detected on your machine')).toBeVisible({ timeout: 20_000 })

    // The known-CLI catalog always renders its rows (status varies by machine). A
    // "Claude Code" label appears at least once; .first() avoids strict-mode clashes
    // when the same CLI is also already connected.
    await expect(page.getByText('Claude Code').first()).toBeVisible()

    // Bring-your-own registration form.
    await expect(page.getByRole('heading', { name: 'Add your own CLI' })).toBeVisible()
    await expect(page.getByLabel('Binary path or command')).toBeVisible()
  })

  test('is reachable from the sidebar', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /Connections/i }).click()
    await expect(page).toHaveURL(/\/connections/)
  })
})
