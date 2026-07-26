import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * Accessibility (WCAG 2.1 A/AA) scan via axe-core. Local app, no login, so we scan
 * the real surfaces: the room page and the Connections screen. We fail on any
 * `serious` or `critical` violation (the WCAG-AA-blocking severities).
 */

const BLOCKING_IMPACTS = new Set(['serious', 'critical'])
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function scan(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''))
}

async function gotoRoom(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

function blockingMessage(blocking: Awaited<ReturnType<typeof scan>>) {
  return blocking.map((v) => `${v.impact}: ${v.id} - ${v.help}`).join('\n')
}

test.describe('accessibility (axe)', () => {
  test('the room page has no serious or critical WCAG violations', async ({ page }) => {
    await gotoRoom(page)

    const blocking = await scan(page)
    expect(blocking, blockingMessage(blocking)).toEqual([])
  })

  test('the mention dropdown has no serious or critical WCAG violations', async ({ page }) => {
    await gotoRoom(page)
    await page.getByRole('combobox', { name: /Message #/ }).fill('@')
    await expect(page.getByRole('listbox', { name: 'Mention suggestions' })).toBeVisible()

    const blocking = await scan(page)
    expect(blocking, blockingMessage(blocking)).toEqual([])
  })

  test('the manage agents dialog has no serious or critical WCAG violations', async ({ page }) => {
    await gotoRoom(page)
    await page.getByRole('button', { name: 'Manage agents' }).click()
    await expect(page.getByRole('dialog', { name: 'Manage room agents' })).toBeVisible()

    const blocking = await scan(page)
    expect(blocking, blockingMessage(blocking)).toEqual([])
  })

  test('the Connections screen has no serious or critical WCAG violations', async ({ page }) => {
    await page.goto('/connections')
    await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible()
    await expect(page.getByText('Detected on your machine')).toBeVisible({ timeout: 20_000 })

    const blocking = await scan(page)
    expect(blocking, blockingMessage(blocking)).toEqual([])
  })
})

test.describe('accessibility keyboard flows', () => {
  test('mentions open as a listbox and can be selected or dismissed with the keyboard', async ({
    page,
  }) => {
    await gotoRoom(page)
    const compose = page.getByRole('combobox', { name: /Message #/ })

    await compose.fill('@')
    await expect(page.getByRole('listbox', { name: 'Mention suggestions' })).toBeVisible()
    await compose.press('ArrowDown')
    await compose.press('Enter')
    await expect(compose).toHaveValue(/^@[\w-]+ $/)

    await compose.fill('@')
    await expect(page.getByRole('listbox', { name: 'Mention suggestions' })).toBeVisible()
    await compose.press('Escape')
    await expect(page.getByRole('listbox', { name: 'Mention suggestions' })).toBeHidden()
  })

  test('manage agents dialog receives focus and returns it to the trigger on Escape', async ({
    page,
  }) => {
    await gotoRoom(page)
    const trigger = page.getByRole('button', { name: 'Manage agents' })
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: 'Manage room agents' })
    await expect(dialog).toBeVisible()
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(node.ownerDocument.activeElement)))
      .toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})
