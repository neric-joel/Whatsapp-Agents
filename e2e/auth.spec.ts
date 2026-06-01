/**
 * auth.spec.ts — Authentication shell tests
 *
 * These tests ONLY require the Next.js web server to be running.
 * No Supabase instance, no bridge, no seeded data. Safe to run in every CI job.
 *
 * What is verified:
 *   1. Unauthenticated visit to "/" redirects to "/auth".
 *   2. The sign-in form renders with the correct fields and submit button.
 *   3. The "Sign Up" tab switches the form to sign-up mode.
 *
 * Selectors are derived from the actual DOM in apps/web/app/auth/page.tsx:
 *   - Email input:    <input id="email" type="email" placeholder="you@example.com">
 *   - Password input: <input id="password" type="password" placeholder="Password">
 *   - Submit button:  <button type="submit"> "Sign in" | "Create account"
 *   - Mode tabs:      role="tab" "Sign In" | "Sign Up" (WAI-ARIA tablist,
 *                     roving tabindex + Left/Right arrow navigation)
 */

import { expect, test } from '@playwright/test'

test.describe('Auth redirect', () => {
  test('unauthenticated visit to / redirects to /auth', async ({ page }) => {
    // AuthGuard in apps/web/components/AuthGuard.tsx calls router.replace('/auth')
    // when the Supabase session is null. Even with a dummy Supabase URL the client
    // initialises without a stored session, so the redirect fires in the browser.
    await page.goto('/')

    // Wait for the auth page to settle. We accept both the final URL and an
    // intermediate state where the page is still hydrating (renders 'none' shell
    // briefly before replacing the route).
    await expect(page).toHaveURL(/\/auth/, { timeout: 15_000 })
  })

  test('auth page renders sign-in form with email and password fields', async ({ page }) => {
    await page.goto('/auth')

    // Heading
    await expect(page.getByRole('heading', { name: 'AgentRoom' })).toBeVisible()

    // Mode tabs use role="tab" (a11y), which disambiguates them from the
    // "Sign in" submit button. Sign In is selected by default.
    const signInTab = page.getByRole('tab', { name: 'Sign In' })
    await expect(signInTab).toBeVisible()
    await expect(signInTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Sign Up' })).toBeVisible()

    // Email field — identified by label "Email" or placeholder
    const emailInput = page.getByLabel('Email')
    await expect(emailInput).toBeVisible()
    await expect(emailInput).toHaveAttribute('type', 'email')

    // Password field — identified by label "Password"
    const passwordInput = page.getByLabel('Password')
    await expect(passwordInput).toBeVisible()
    await expect(passwordInput).toHaveAttribute('type', 'password')

    // Submit button (type=submit) shows "Sign in" in signin mode.
    await expect(page.locator('button[type="submit"]')).toHaveText('Sign in')
  })

  test('switching to Sign Up tab updates the submit button label', async ({ page }) => {
    await page.goto('/auth')

    await page.getByRole('tab', { name: 'Sign Up' }).click()

    // Submit button (type=submit) changes to "Create account"
    await expect(page.locator('button[type="submit"]')).toHaveText('Create account')

    // The password field autocomplete attribute changes to new-password in signup mode.
    // This validates the mode state is actually toggled.
    await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'new-password')
  })

  test('tablist supports arrow-key navigation (WAI-ARIA tabs)', async ({ page }) => {
    await page.goto('/auth')

    const signIn = page.getByRole('tab', { name: 'Sign In' })
    const signUp = page.getByRole('tab', { name: 'Sign Up' })

    // Focus the active tab, then ArrowRight should select + focus Sign Up.
    await signIn.focus()
    await page.keyboard.press('ArrowRight')
    await expect(signUp).toHaveAttribute('aria-selected', 'true')
    await expect(signUp).toBeFocused()
    await expect(page.locator('button[type="submit"]')).toHaveText('Create account')

    // ArrowLeft returns to Sign In.
    await page.keyboard.press('ArrowLeft')
    await expect(signIn).toHaveAttribute('aria-selected', 'true')
    await expect(signIn).toBeFocused()
  })

  test('submitting empty form does not navigate away from /auth', async ({ page }) => {
    await page.goto('/auth')

    // HTML5 required validation should block submit when fields are empty.
    // We click the submit button directly (not via keyboard) to trigger validation.
    await page.locator('button[type="submit"]').click()

    // Still on /auth — the required constraint prevents form submission.
    await expect(page).toHaveURL(/\/auth/)
  })
})
