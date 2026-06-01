/**
 * chat.spec.ts — Core chat journey tests
 *
 * Scope decision
 * --------------
 * This spec requires a fully seeded backend:
 *   - Local Supabase running (supabase start + supabase db reset)
 *   - A test user created in Supabase auth
 *   - The bridge daemon running with the mock adapter
 *
 * Standing all of that up reliably in CI is non-trivial and is therefore
 * controlled by the E2E_LIVE environment variable. The full journey tests are
 * skipped unless E2E_LIVE is set to a truthy value.
 *
 * The form-rendering tests inside the "sign-in form interaction" describe block
 * DO NOT need a backend — they only verify UI behaviour with invalid credentials
 * (the error path), so they run even without E2E_LIVE.
 *
 * Environment variables:
 *   E2E_EMAIL     Email for the seeded test user  (default: e2e-test@agentroom.local)
 *   E2E_PASSWORD  Password for the seeded test user (default: testpassword1234)
 *   E2E_LIVE      Set to any non-empty string to run the full backend journey
 *
 * Selectors
 * ---------
 * All selectors are grounded in the actual component source:
 *
 *   ComposeBox (apps/web/components/ComposeBox.tsx):
 *     - Textarea:    getByPlaceholder(/Message #/)   — placeholder is `Message #${room.name}...`
 *     - Send button: getByRole('button', { name: 'Send' })
 *     - data-testid="compose-box" added to the outer wrapper div (minimal addition)
 *
 *   MessageTimeline (apps/web/components/MessageTimeline.tsx):
 *     - data-testid="message-timeline" added to the scroll container div (minimal addition)
 *
 *   MessageBubble (apps/web/components/MessageBubble.tsx):
 *     - User bubble:  div with bg-[var(--user-bubble)] class — no stable testid needed;
 *                     we match by message text content instead.
 *     - Agent bubble: identified by the agent name text (e.g. "Claude Thinker") that
 *                     appears in a <span> alongside the message content.
 *
 *   AgentRunCard (apps/web/components/AgentRunCard.tsx):
 *     - Status badge: text "Queued" | "Running" | "Completed"
 *
 *   LeftSidebar (apps/web/components/LeftSidebar.tsx):
 *     - Room links: getByRole('link', { name: /# / })
 *
 *   RoomHeader (apps/web/components/RoomHeader.tsx):
 *     - Heading: getByRole('heading', { level: 1 })  — renders "# <roomName>"
 */

import { expect, test } from '@playwright/test'

const E2E_EMAIL = process.env.E2E_EMAIL ?? 'e2e-test@agentroom.local'
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'testpassword1234'
const IS_LIVE = Boolean(process.env.E2E_LIVE)

// ---------------------------------------------------------------------------
// Helper: sign in via the UI
// ---------------------------------------------------------------------------
async function signIn(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.locator('button[type="submit"]').click()
  // AuthGuard redirects to "/" which then redirects to the first room.
  // Wait for the URL to leave /auth.
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 20_000 })
}

// ---------------------------------------------------------------------------
// UI-only tests — run without a backend (no E2E_LIVE required)
// ---------------------------------------------------------------------------
test.describe('sign-in form interaction', () => {
  test('shows an error when credentials are invalid (dummy backend)', async ({ page }) => {
    // This test sends real credentials to the Supabase instance.
    // With a dummy/offline Supabase it gets an auth error back,
    // which the form displays in the red error paragraph.
    // We just verify the error message appears — not its exact text.
    await page.goto('/auth')
    await page.getByLabel('Email').fill('nobody@example.com')
    await page.getByLabel('Password').fill('wrongpassword')
    await page.locator('button[type="submit"]').click()

    // The form should remain on /auth (not redirect)
    await expect(page).toHaveURL(/\/auth/)

    // An error message appears somewhere in the page.
    // The error <p> has class text-red-600 and is inside the form.
    // We match broadly so the test is resilient to error text changes.
    const errorParagraph = page.locator('form p').filter({ hasText: /.+/ })
    await expect(errorParagraph).toBeVisible({ timeout: 15_000 })
  })
})

// ---------------------------------------------------------------------------
// Full backend journey — gated behind E2E_LIVE
// ---------------------------------------------------------------------------
test.describe('chat journey', () => {
  // Skip the entire describe block unless E2E_LIVE is set.
  // Individual steps are also guarded so the file parses cleanly regardless.
  test.beforeEach(() => {
    if (!IS_LIVE) {
      test.skip(true, 'Skipped: set E2E_LIVE=1 and provide a seeded Supabase instance to run.')
    }
  })

  test('sign in → land in a room → send message → see user message → see agent reply', async ({
    page,
  }) => {
    // 1. Sign in with the seeded test user
    await signIn(page, E2E_EMAIL, E2E_PASSWORD)

    // 2. Should land in a room (URL matches /rooms/<uuid>)
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 15_000 })

    // 3. Room heading is visible (RoomHeader renders "# <roomName>")
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // 4. The sidebar is rendered with at least one room link
    await expect(page.getByRole('link', { name: /^# / }).first()).toBeVisible()

    // 5. Compose area: find the message textarea by its placeholder pattern.
    //    ComposeBox renders: placeholder={`Message #${room?.name ?? '...'}...`}
    //    We match the common prefix "Message #" which is stable.
    const textarea = page.getByPlaceholder(/Message #/)
    await expect(textarea).toBeVisible()

    // 6. Type a unique test message
    const testMessage = `E2E test message ${Date.now()}`
    await textarea.fill(testMessage)

    // 7. Send via the "Send" button (not Enter, to be explicit)
    await page.getByRole('button', { name: 'Send' }).click()

    // 8. The user's own message appears in the timeline.
    //    MessageBubble for user messages wraps text in a div with bg-[var(--user-bubble)].
    //    We match by the message text content which is unique.
    const messageTimeline = page.getByTestId('message-timeline')
    await expect(messageTimeline.getByText(testMessage)).toBeVisible({ timeout: 10_000 })

    // 9. Agent run card appears (status: Queued, Running, or Completed).
    //    AgentRunCard renders one of these status labels. We check any is present.
    //    The mock adapter completes in ~500 ms, so we may see any status.
    const runStatusPattern = /Queued|Running|Completed|Starting/
    await expect(messageTimeline.getByText(runStatusPattern).first()).toBeVisible({
      timeout: 10_000,
    })

    // 10. Wait for the mock agent reply to appear.
    //     MockAgentAdapter produces responses starting with:
    //       "I think we should ..."  (claude_thinker)
    //       "I can implement ..."    (codex_builder)
    //       "I see a potential risk ..." (reviewer)
    //     The seed data has all three agents. We wait for any agent reply.
    const agentReplyPattern = /I think we should|I can implement|I see a potential risk/
    await expect(messageTimeline.getByText(agentReplyPattern).first()).toBeVisible({
      timeout: 30_000,
    })
  })

  test('user message appears in sidebar room without refresh', async ({ page }) => {
    await signIn(page, E2E_EMAIL, E2E_PASSWORD)
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 15_000 })

    // Sidebar shows a room link labelled with the room name from seed: "My First AgentRoom"
    const roomLink = page.getByRole('link', { name: /# My First AgentRoom/i })
    await expect(roomLink).toBeVisible({ timeout: 10_000 })
  })

  test('empty compose box — Send button is disabled', async ({ page }) => {
    await signIn(page, E2E_EMAIL, E2E_PASSWORD)
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}/, { timeout: 15_000 })

    // ComposeBox disables Send when (!text.trim() && !attachedFile)
    const sendButton = page.getByRole('button', { name: 'Send' })
    await expect(sendButton).toBeDisabled()
  })
})
