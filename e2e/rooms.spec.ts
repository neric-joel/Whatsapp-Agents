/**
 * rooms.spec.ts — room setup with the agent catalog + rename (Phase C).
 *
 * No agents are forced on a room; the New-room dialog offers a catalog of connected
 * CLIs to pick from (empty-state when none are connected). Rooms are renamable. Serial +
 * self-contained because these mutate shared room state on the single dev server.
 */
import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

/**
 * Submits an already-filled New-room dialog and waits until the browser is in THE room
 * that was just created, returning its id.
 *
 * Asserting `toHaveURL(/\/rooms\/<uuid>/)` here would be vacuous: `app/page.tsx` redirects
 * `/` to `rooms[0]` whenever any room exists, so once an earlier spec has created one the
 * generic match is already satisfied before Create is even clicked. It then passes while
 * leaving the browser on a *different* room. That is what made the rename test below ~50%
 * flaky in the full suite and green in isolation — with an empty DB there is nothing to
 * redirect to, so the assertion accidentally did the right thing. Captured evidence from a
 * failing run: url room = the seeded "My First AgentRoom", sidebar correctly showed the
 * renamed room, and the composer correctly showed the *active* room's name.
 */
async function submitNewRoom(
  page: import('@playwright/test').Page,
  dialog: import('@playwright/test').Locator,
) {
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/rooms',
  )
  await dialog.getByRole('button', { name: 'Create' }).click()
  const payload = (await (await created).json()) as { data: { id: string } }
  await expect(page).toHaveURL(new RegExp(`/rooms/${payload.data.id}$`), { timeout: 15_000 })
  return payload.data.id
}

async function createRoom(page: import('@playwright/test').Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name: '+ New Room' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('New room')).toBeVisible()
  await page.getByLabel('Room name').fill(name)
  return submitNewRoom(page, dialog)
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
  await submitNewRoom(page, dialog)
  // The created room appears in the sidebar list (refreshRooms after create).
  await expect(page.getByRole('navigation', { name: 'Room list' }).getByText(name)).toBeVisible({
    timeout: 10_000,
  })
})

test('a room can be renamed from its menu', async ({ page }) => {
  const original = `ToRename ${Date.now().toString().slice(-5)}`
  await createRoom(page, original)

  const nav = page.getByRole('navigation', { name: 'Room list' })
  const activeRoomRow = nav.getByRole('link', { name: `# ${original}` }).locator('xpath=..')
  await activeRoomRow.getByRole('button', { name: 'Room actions' }).click()
  const renamed = `Renamed ${Date.now().toString().slice(-5)}`
  page.once('dialog', (d) => d.accept(renamed))
  await page.getByRole('button', { name: /Rename/ }).click()

  await expect(nav.getByText(renamed)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByPlaceholder(`Message #${renamed}...`)).toBeVisible({ timeout: 10_000 })
})
