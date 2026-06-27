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
    // Let the home → first-room redirect settle first, otherwise it races the click.
    await expect(page).toHaveURL(/\/(rooms\/[0-9a-f-]{36})?$/, { timeout: 20_000 })
    await page.getByRole('link', { name: /Connections/i }).click()
    await expect(page).toHaveURL(/\/connections/)
  })

  test('renders a single sidebar (no double-shell regression)', async ({ page }) => {
    // Regression guard: wrapping the page in AuthGuard while the root layout already
    // wraps it rendered TWO sidebars and pushed the panel (and its Connect buttons)
    // off-screen — the "broken Connect button". The shell must appear exactly once.
    await page.goto('/connections')
    await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Connections/i })).toHaveCount(1)
  })

  test('Connect (via the BYO form) registers a CLI and shows it as connected', async ({ page }) => {
    // The detected-CLI "Connect" button is disabled on a runner with no CLIs installed,
    // so exercise the same POST /api/connections path through the always-available
    // bring-your-own form, then assert the connected state appears.
    await page.goto('/connections')
    await expect(page.getByRole('heading', { name: 'Add your own CLI' })).toBeVisible()
    const slug = `e2e${Date.now().toString().slice(-6)}`
    await page.getByLabel('Display name').fill('E2E Test CLI')
    await page.getByLabel('@mention handle').fill(slug)
    await page.getByLabel('Binary path or command').fill('node')
    await page.getByRole('button', { name: 'Add CLI' }).click()

    // Success notice + the profile now appears under "Connected CLIs".
    await expect(page.getByRole('status').filter({ hasText: /connected/i })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText(`@${slug}`)).toBeVisible()
  })
})
