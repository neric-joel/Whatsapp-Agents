# Phase 3 Testing — Critique Gate

- **Date:** 2026-05-30
- **Branch:** `harden/p3-tests` (stacked on `harden/p2-quality`)
- **Reviewer:** QA/Verification reviewer (`qa-expert` `.claude` subagent)
- **Outcome:** initial **FAIL** (Critical + High found) → **fixed & re-verified** → **PASS**.

## Initial verdict: FAIL — and that was correct
The QA reviewer ran the browsers and the suites adversarially and found real defects the scaffolding had missed:
- **[Critical]** `e2e/auth.spec.ts` + the `signIn()` helper used `getByRole('button', { name: 'Sign in' })` — case-insensitive, so it matched BOTH the `Sign In` tab and the `Sign in` submit button (strict-mode violation). 3 of 5 runnable specs failed on first browser run. The DoD "runs deterministically in CI" was not met.
- **[High]** The pgTAP RLS tests existed but were not wired into any CI path → no automated gate against a policy/migration regression.
- **[Medium]** `createRoomSchema`/`sendMessageSchema`/`createPinSchema`/`updatePinSchema` had no unit tests; `bridge/src/workers/run-worker.ts` is excluded from coverage.

## Fixes applied + re-verification (evidence)
- **Critical (selectors) — FIXED & VERIFIED.** Tabs now use `{ name: 'Sign In', exact: true }`; the submit button uses `page.locator('button[type="submit"]')` (in both `auth.spec.ts` and the `signIn()` helper). Ran the browsers locally:
  - `npx playwright test e2e/auth.spec.ts` → **4 passed**
  - `npx playwright test e2e/chat.spec.ts` → **1 passed, 3 skipped** (chat journey gated on `E2E_LIVE`)
  - i.e. **5/5 non-skipped e2e pass deterministically** with just the web server — exactly what `e2e.yml` runs in CI.
- **High (RLS not in CI) — FIXED & VERIFIED.** Added `.github/workflows/db-tests.yml` (`supabase db start` → `supabase test db`). Proved both pgTAP suites green against a live Postgres (pgtap installed temporarily, then dropped):
  - `storage_rls_test.sql` → `1..6`, **ok 1–6**
  - `rls_policies_test.sql` → `1..4`, **ok 1–4**
- **Medium (untested schemas) — FIXED.** `apps/web/lib/__tests__/api-validation.test.ts` (17 tests) covers createRoom/sendMessage/createPin/updatePin happy + failure paths. Web suite 76 → **93 tests**; lib coverage 89.6% → **90.0%** lines.
- **Medium (`run-worker.ts` coverage) — ACCEPTED/DEFERRED.** The 356-line claim→run→stream orchestration needs a live Supabase client to exercise; unit-covering it requires substantial mocking. Deferred to Phase 6 (reliability/chaos) where induced-failure tests will exercise it. Documented here and in PROGRESS.

## Final state (all independently re-run)
- `pnpm -r typecheck` green · `pnpm lint` 0 errors (29 warnings → Phase 4) · `pnpm format:check` clean · `pnpm exec knip` exit 0
- `pnpm test:coverage`: **154 tests** (61 bridge + 93 web); coverage gates pass (bridge 60.7% lines ≥ 55 floor; web 90.0% lines ≥ 80 floor)
- e2e: 5/5 non-skipped pass in Chromium; `playwright test --list` = 8 specs
- pgTAP: 10/10 assertions pass; `db-tests.yml` wires `supabase test db` into CI
- Regression-caught proof: temporarily set `isForbiddenCrossOrigin` → `return false`; 2 CSRF tests failed; reverted (tree clean). Suite demonstrably catches a real regression.

No open Critical/High after fixes. Phase 3 acceptance criteria met with linked evidence.
