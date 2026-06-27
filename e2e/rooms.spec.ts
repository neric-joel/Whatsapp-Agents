/**
 * rooms.spec.ts — room setup with the agent catalog + rename (Phase C).
 *
 * No agents are forced on a room; the New-room dialog offers a catalog of connected
 * CLIs to pick from (empty-state when none are connected). Rooms are renamable. Serial +
 * self-contained because these mutate shared room state on the single dev server.
 */
import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

async function createRoom(page: import('@playwright/test').Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: '+ New Room' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('New room')).toBeVisible()
  await page.getByLabel('Room name').fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 15_000 })
}

test('the New-room dialog offers an agent catalog (no forced agents) and creates a room', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: '+ New Room' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('New room')).toBeVisible()
  // The "select your agents" catalog is present (connected CLIs or the empty hint).
  await expect(dialog.getByText(/pick who joins this room/i)).toBeVisible()

  const name = `Catalog Room ${Date.now().toString().slice(-5)}`
  await page.getByLabel('Room name').fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 15_000 })
  // The created room appears in the sidebar list (refreshRooms after create).
  await expect(page.getByRole('navigation', { name: 'Room list' }).getByText(name)).toBeVisible({
    timeout: 10_000,
  })
})

test('a room can be renamed from its menu', async ({ page }) => {
  const original = `ToRename ${Date.now().toString().slice(-5)}`
  await createRoom(page, original)

  const nav = page.getByRole('navigation', { name: 'Room list' })
  // The newly-created room sorts to the top (most recently active). Open its menu.
  await nav.getByRole('button', { name: 'Room actions' }).first().click()
  const renamed = `Renamed ${Date.now().toString().slice(-5)}`
  page.once('dialog', (d) => d.accept(renamed))
  await page.getByRole('button', { name: /Rename/ }).click()

  await expect(nav.getByText(renamed)).toBeVisible({ timeout: 10_000 })
})
