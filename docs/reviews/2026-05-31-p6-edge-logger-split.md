# Review — Edge-safe origin/CSRF helper extraction (Phase 6 follow-up)

- **Date:** 2026-05-31
- **Branch:** `harden/p6-edge-logger-split` (stacked off `harden/p8-release-scaffold` HEAD; PR → `main`)
- **Commit:** `7466615` `fix(p6): extract Edge-safe origin/CSRF helpers into logger-free module`
- **Reviewer asset:** `code-reviewer` (`~/.claude`), adversarial behavior-preservation pass.

## Context

`apps/web/middleware.ts` runs on the **Edge runtime**. It imported
`isForbiddenCrossOrigin` from `apps/web/lib/api-security.ts`, which top-level imports
the Node `logger` (`process.stdout/stderr`) and `error-tracking`. That dragged the
Node logger into the Edge bundle and produced a `next build` Edge-runtime warning
(pre-existing since `ae0d7ef`; logged under PROGRESS *For morning review* as a Phase 6
follow-up — "small, low-risk").

## Change

- New logger-free module `apps/web/lib/origin.ts` with the **pure** helpers
  `allowedOrigins`, `isForbiddenCrossOrigin`, `safeOrigin` (sole dependency:
  `getBearerToken` from `./api-auth`, a zero-import pure helper).
- `api-security.ts` re-exports `allowedOrigins` + `isForbiddenCrossOrigin` from
  `./origin` (backward compatible for route handlers + tests) and imports
  `isForbiddenCrossOrigin` for its `assertSameOrigin` guard.
- `middleware.ts` imports `isForbiddenCrossOrigin` from `@/lib/origin`.

## Verification (evidence)

- `pnpm typecheck` ✓
- `pnpm lint` ✓ (0 errors / 7 known Phase-4 warnings)
- `pnpm knip` ✓ (0 findings)
- `pnpm test` ✓ (bridge 84/0; web suite pass)
- `pnpm --filter web build` ✓ — **"Compiled successfully", 0 Edge-runtime warnings**
  (`grep -c "not supported in the Edge Runtime|A Node.js module is loaded|A Node.js API is used"` = 0).

## Critique verdict: **PASS** — 0 Critical/High/Med/Low

- CSRF/cross-origin logic **byte-identical** to the removed code (Bearer exemption,
  missing-Origin → forbidden, allowlist check). No security regression.
- All `api-security` importers (route handlers + `api-security.test.ts`) resolve
  through the re-export; no behavioral change.
- `origin.ts` is genuinely Edge-safe (only `URL`/`Set`/`process.env`; no logger,
  error-tracking, fs, or `process.stdout/stderr`); `api-auth.ts` is a pure leaf.
- Acyclic: `origin.ts → api-auth.ts`; `api-security.ts → origin.ts`. No dead code.

No open Critical/High. Behavior-preserving refactor; clears the last known build warning.
