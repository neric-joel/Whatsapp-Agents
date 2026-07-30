/**
 * zz-console-hygiene.spec.ts — the browser's own error channels, as a gate.
 *
 * Every other spec here asserts on rendered output, so a page can satisfy all of them
 * while throwing in the console on every load. This spec is the one that fails on that:
 * for each core route it asserts zero `console.error`, zero uncaught page errors, and no
 * 4xx/5xx or genuinely-failed request.
 *
 * `requestfailed` also fires for ABORTED requests, and Next's App Router routinely
 * cancels in-flight RSC prefetches (`?_rsc=`) when the client navigates. Those are
 * expected, so the reason is captured and `net::ERR_ABORTED` is classified separately
 * rather than counted as a failure — otherwise this spec would be permanently red for a
 * behaviour that is working as designed.
 *
 * The `zz-` prefix is load-bearing — do not rename it without reading this. Playwright
 * runs spec FILES in alphabetical order, and this suite is `workers: 1` against ONE shared
 * single-user SQLite DB (see playwright.config.ts). The room-creation flow below leaves
 * rooms behind, and as `console-hygiene.spec.ts` it sorted ahead of `rooms.spec.ts` and
 * made its rename test fail — the sidebar picked up the new name but the composer
 * placeholder did not. Sorting last means this spec cannot perturb anything downstream.
 * Verified both ways: full suite red as `console-*`, green as `zz-console-*`, and the
 * rename test passes in isolation either way.
 *
 * Serial within the file for the same shared-DB reason.
 */
import { type ConsoleMessage, expect, type Page, test } from '@playwright/test'

interface Watched {
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: string[]
  abortedRequests: string[]
}

/** Attach before the first navigation, or early errors are missed. */
function watch(page: Page): Watched {
  const w: Watched = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    abortedRequests: [],
  }
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') w.consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => w.pageErrors.push(`${e.name}: ${e.message}`))
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? 'unknown'
    const line = `${why} :: ${r.method()} ${r.url()}`
    if (why === 'net::ERR_ABORTED') w.abortedRequests.push(line)
    else w.failedRequests.push(line)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) {
      w.failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`)
    }
  })
  return w
}

function expectClean(w: Watched) {
  expect(w.pageErrors, 'uncaught page errors').toEqual([])
  expect(w.consoleErrors, 'console.error calls').toEqual([])
  expect(w.failedRequests, 'failed or 4xx/5xx requests (aborts excluded)').toEqual([])
}

test.describe.configure({ mode: 'serial' })

test('the room list loads with a clean console', async ({ page }) => {
  const w = watch(page)
  await page.goto('/')

  await expect(page.getByRole('complementary', { name: 'Rooms' })).toBeVisible()
  await expect(page.getByRole('button', { name: '+ New Room' })).toBeVisible()

  expectClean(w)
})

test('creating a room and landing in it keeps the console clean', async ({ page }) => {
  // A mutation is where a React error is most likely, so this flow belongs here. It was
  // withheld for a while because adding it destabilized `rooms.spec.ts:42` — attributed at
  // the time to the room's new name reaching the sidebar before the composer. That was
  // wrong: the browser was on a *different room altogether*, because `/` redirected to
  // rooms[0] from a client effect that could land after creation's own navigation. That
  // redirect is server-side now (app/page.tsx) and cannot compete, so the flow is safe to
  // assert — and being the last spec file, it still cannot perturb anything downstream.
  const w = watch(page)
  await page.goto('/')

  await page.getByRole('button', { name: '+ New Room' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('New room')).toBeVisible()

  const name = `Console Hygiene ${Date.now().toString().slice(-5)}`
  await page.getByLabel('Room name').fill(name)

  // Require THE created room, not merely some room — see rooms.spec.ts for why a generic
  // /rooms/<uuid> match is vacuous here.
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/rooms',
  )
  await dialog.getByRole('button', { name: 'Create' }).click()
  const { data } = (await (await created).json()) as { data: { id: string } }
  await expect(page).toHaveURL(new RegExp(`/rooms/${data.id}$`), { timeout: 15_000 })
  await expect(page.getByPlaceholder(`Message #${name}...`)).toBeVisible({ timeout: 10_000 })

  expectClean(w)
})

test('the connections and settings routes load with a clean console', async ({ page }) => {
  const w = watch(page)

  await page.goto('/connections')
  await expect(page.getByRole('heading', { name: /connections/i }).first()).toBeVisible()

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: /settings|providers/i }).first()).toBeVisible()

  expectClean(w)
})
