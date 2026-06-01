import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for AgentRoom e2e tests.
 *
 * Execution strategy:
 *   - auth.spec.ts  — only requires the Next.js web server (no Supabase, no bridge).
 *                     Runs in every CI job.
 *   - chat.spec.ts  — requires a seeded Supabase DB + bridge running mock adapter.
 *                     Gated behind E2E_LIVE=1. Skipped in CI unless that flag is set.
 *
 * Environment variables consumed by specs:
 *   E2E_EMAIL      Test user email    (default: e2e-test@agentroom.local)
 *   E2E_PASSWORD   Test user password (default: testpassword1234)
 *   E2E_LIVE       Set to any truthy value to run the full chat journey
 *   BASE_URL       Override the base URL (default: http://localhost:3000)
 */

export default defineConfig({
  testDir: './e2e',

  // Fail fast on CI if a test is accidentally left as test.only
  forbidOnly: !!process.env.CI,

  // Retry flaky tests once in CI, never locally
  retries: process.env.CI ? 1 : 0,

  // Limit parallelism: keep the suite lean and deterministic
  workers: process.env.CI ? 2 : undefined,

  // Reporters: brief on CI, verbose list locally
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: 'playwright-report' }]],

  // Global timeouts
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',

    // Collect traces on first retry so failures are debuggable without re-running
    trace: 'on-first-retry',

    // Record video only on retry so CI artifacts are meaningful
    video: 'on-first-retry',

    // Capture a screenshot on every test failure
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /**
   * Web server: start Next.js dev server if not already running.
   *
   * - In CI (reuseExistingServer: false) a fresh server is always started.
   * - Locally the existing dev server is reused when available, speeding up
   *   iterative test development.
   *
   * The web server does NOT need Supabase to boot — it will return 500 on
   * data-fetching routes, but the auth redirect spec only checks the HTML shell.
   */
  webServer: {
    command: 'pnpm --filter web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Provide dummy values so Next.js does not crash during SSR init.
      // The real values are injected from CI secrets when E2E_LIVE=1.
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'dummy-publishable-key',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'dummy-service-role-key',
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    },
  },
})
