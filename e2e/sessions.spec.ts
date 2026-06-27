/**
 * sessions.spec.ts — Cowork-style working folder + sessions (Phase B).
 *
 * Only needs the web server. The session lives in local SQLite, so it must survive a
 * reload. The working folder is a real server-side path (this machine), so the spec
 * creates a temp dir and "opens" it.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

/**
 * Ensure the SessionBar's working-folder form is open. On a fresh home it appears after a
 * brief load; once a session exists it's collapsed behind a "＋ New" button. Scope to the
 * SessionBar (aria-label "Working session") so we never hit the sidebar's "+ New Room".
 */
async function openSessionForm(page: import('@playwright/test').Page) {
  const bar = page.getByRole('group', { name: 'Working session' })
  const folderInput = page.getByLabel('Working folder')
  const visible = await folderInput.waitFor({ state: 'visible', timeout: 8000 }).then(
    () => true,
    () => false,
  )
  if (!visible) {
    await bar.getByRole('button', { name: /New/ }).click()
    await folderInput.waitFor({ state: 'visible', timeout: 8000 })
  }
  return folderInput
}

test('first run prompts for a working folder; the session persists across reload', async ({
  page,
}) => {
  const workDir = mkdtempSync(join(tmpdir(), 'agentroom-session-e2e-'))
  await page.goto('/')

  const folderInput = await openSessionForm(page)
  await folderInput.fill(workDir)
  await page.getByLabel('Session name').fill('E2E Session')
  await page.getByRole('button', { name: 'Open folder' }).click()

  // The active session now shows its name + the working folder.
  await expect(page.getByRole('button', { name: 'E2E Session' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(workDir, { exact: false })).toBeVisible()

  // Resume after reload — the session is persisted in SQLite, not just client state.
  await page.reload()
  await expect(page.getByRole('button', { name: 'E2E Session' })).toBeVisible({ timeout: 10_000 })
})

test('rejects a non-existent working folder with a clear error', async ({ page }) => {
  await page.goto('/')
  const folderInput = await openSessionForm(page)
  await folderInput.fill('/no/such/folder/anywhere-xyz')
  await page.getByLabel('Session name').fill('Bad')
  await page.getByRole('button', { name: 'Open folder' }).click()
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 })
})
