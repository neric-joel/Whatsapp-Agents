/**
 * app.spec.ts — the local app shell.
 *
 * Only needs the web server. AgentRoom is local + single-user: opening "/" drops you
 * straight into the app (no /auth, no login). The DB seeds a starter room on first
 * request, so "/" redirects into it.
 */
import { expect, test } from '@playwright/test'

test.describe('local app shell', () => {
  test('opening / goes straight into the app — never /auth', async ({ page }) => {
    await page.goto('/')
    // The seeded room makes "/" redirect to /rooms/<uuid>. Either way we must not be
    // sent to a login page (there isn't one).
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 20_000 })
    await expect(page).not.toHaveURL(/\/auth/)
  })

  test('the room shell renders: sidebar, room heading, compose box', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 20_000 })

    // Sidebar with the Connections + Settings entry points.
    await expect(page.getByRole('link', { name: /Connections/i })).toBeVisible()
    // Room heading (RoomHeader renders the room name as an h1).
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Compose box.
    await expect(page.getByPlaceholder(/Message #/)).toBeVisible()
  })
})
