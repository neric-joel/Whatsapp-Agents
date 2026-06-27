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

test('first run prompts for a working folder; the session persists across reload', async ({
  page,
}) => {
  const workDir = mkdtempSync(join(tmpdir(), 'agentroom-session-e2e-'))
  await page.goto('/')

  // The SessionBar (in the sidebar) shows the working-folder picker on first run. If a
  // session already exists (shared dev server on a re-run), open the New-session form.
  const folderInput = page.getByLabel('Working folder')
  if (!(await folderInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '＋ New' }).click()
  }
  await expect(folderInput).toBeVisible({ timeout: 20_000 })
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
  const folderInput = page.getByLabel('Working folder')
  // If a session already exists from the test above (shared server), open the New form.
  if (!(await folderInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '＋ New' }).click()
  }
  await page.getByLabel('Working folder').fill('/no/such/folder/anywhere-xyz')
  await page.getByLabel('Session name').fill('Bad')
  await page.getByRole('button', { name: 'Open folder' }).click()
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 })
})
