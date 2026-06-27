import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for AgentRoom e2e tests.
 *
 * AgentRoom is a local, single-user app: no Supabase, no login. The web server boots
 * against an isolated, throwaway app-data home (AGENTROOM_HOME) so the suite never
 * touches your real ~/.agentroom, and a fresh SQLite DB is seeded on first request.
 *
 *   - app.spec.ts / connections.spec.ts / a11y.spec.ts — only need the web server.
 *   - chat.spec.ts journey — needs the bridge + a real CLI; gated behind E2E_LIVE=1.
 */

const E2E_HOME = process.env.AGENTROOM_HOME ?? mkdtempSync(join(tmpdir(), 'agentroom-e2e-'))

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Single worker: this is a single-user app backed by ONE shared SQLite DB, so specs
  // that create rooms/sessions would race each other if run in parallel. Serialize.
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: 'playwright-report' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AGENTROOM_HOME: E2E_HOME,
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    },
  },
})
