/**
 * chat.spec.ts — composing in a room.
 *
 * The empty-compose check needs only the web server. The full send→reply journey
 * needs the bridge running with a real (or mock) CLI connected, so it's gated behind
 * E2E_LIVE=1 (skipped in CI).
 */
import { expect, test } from '@playwright/test'

const IS_LIVE = Boolean(process.env.E2E_LIVE)

async function gotoRoom(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 20_000 })
}

test.describe('compose', () => {
  test('the Send button is disabled until you type', async ({ page }) => {
    await gotoRoom(page)
    const send = page.getByRole('button', { name: 'Send' })
    await expect(send).toBeDisabled()
    await page.getByPlaceholder(/Message #/).fill('hello')
    await expect(send).toBeEnabled()
  })
})

test.describe('send → reply journey (live)', () => {
  test.beforeEach(() => {
    if (!IS_LIVE) test.skip(true, 'Set E2E_LIVE=1 with the bridge + a connected CLI to run.')
  })

  test('a message gets at least one agent reply', async ({ page }) => {
    await gotoRoom(page)
    const msg = `e2e ${Date.now()}`
    await page.getByPlaceholder(/Message #/).fill(msg)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByTestId('message-timeline').getByText(msg)).toBeVisible({ timeout: 10_000 })
    // An agent reply appears within the bridge's poll + CLI runtime.
    await expect(page.getByTestId('message-timeline')).toContainText(/\w/, { timeout: 60_000 })
  })
})
