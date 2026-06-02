# Adversarial Critic / Red-Team — WS-UX + WS2-UI sweep

- **Date:** 2026-06-01
- **Branch:** `feat/product-validation-v1`
- **Reviewer role:** Adversarial Critic / Red-Team (`/critique ux` panel)
- **Commits under attack:** `622397d` (next/font self-host + CSP) and `d67b23f` (credential-crypto server-only + WCAG-AA themes)
- **Method:** read the actual code, computed contrast ratios myself, curled the live dev server, inspected built CSS + the `next/font` loader source. No claim below is taken on trust.

---

## TARGET 1 — next/font self-hosting (layout.tsx + globals.css + next.config CSP)

### 1a. CRITICAL — brand DM Sans is NOT actually applied to body / UI text (cascade defeat)

The whole premise of `622397d` is "the brand typography now actually loads." For the **monospace** path that is true. For the **dominant body/UI text it is false**, and the proof is a CSS specificity collision the commit never checked.

- `<body className="... font-sans ...">` is unchanged by the commit (`apps/web/app/layout.tsx:29`). It pre-dates this work but is load-bearing here.
- Tailwind config has `theme: { extend: {} }` (`apps/web/tailwind.config.ts:8`) — no custom `fontFamily.sans` — so `.font-sans` resolves to Tailwind's **default** stack.
- Built CSS served by the running app (`/_next/static/css/app/layout.css`):
  - `.font-sans { font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", ... }`  ← selector specificity **(0,1,0)**
  - `body { font-family: var(--font-dm-sans), 'DM Sans', ui-sans-serif, ... }`  ← selector specificity **(0,0,1)**
- No `@layer` is used (verified: `@layer present: False`), so the cascade is decided purely by specificity. A class selector (0,1,0) beats a type selector (0,0,1) **regardless of source order**.

**Net effect:** `<body>` (and everything inheriting from it) renders in `ui-sans-serif`/system fonts, NOT DM Sans. The self-hosted DM Sans woff2 IS downloaded and served (see 1b), but the rule that would use it on `body` is overridden. The commit added the `--font-dm-sans` variable to the `body` element rule — the one selector that `font-sans` on the same element is guaranteed to outrank.

JetBrains Mono on `code/pre` (`globals.css:21-23`) DOES work: those elements have no competing `.font-mono` utility, so the element rule wins and `var(--font-jetbrains-mono)` applies.

**Evidence (exact built rules, same file, no @layer):**
```
.font-sans { font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"; }
body { font-family: var(--font-dm-sans), 'DM Sans', ui-sans-serif, system-ui, ...; }
```
`grep` confirms `font-sans` appears exactly once in the codebase — on `<body>` — and nothing re-asserts DM Sans lower in the tree.

**Why the Lighthouse "best-practices 100 / a11y 100" verification did not catch it:** Lighthouse does not assert which font family painted; it flagged the *CSP console error* (now gone) and font-display. Removing the blocked Google `<link>` legitimately fixed the console error and IP leak — but the brand font still doesn't paint on body. The commit conflated "CSP error gone" with "brand font renders."

**Fix:** either (a) set Tailwind `theme.extend.fontFamily.sans = ['var(--font-dm-sans)', ...fallbacks]` and `fontFamily.mono = ['var(--font-jetbrains-mono)', ...]` so the utility itself carries the brand font, or (b) drop `font-sans` from `<body>` so the `body` element rule wins, or (c) apply `${dmSans.className}` (not just `.variable`) to `<body>`. Option (a) is correct and idempotent.
**Disposition: ACCEPT.**

### 1b. MEDIUM — build-time network dependency on fonts.gstatic.com (offline / WS3 cold-clone breaks the build)

`next/font/google` does NOT embed the font binaries in the package — it fetches them at build/first-compile.

- `next/dist/compiled/@next/font/dist/google/loader.js` calls `fetchCSSFromGoogleFonts` and resolves `https://fonts.gstatic.com`, then: `if (fontFileBuffer == null) nextFontError("Failed to fetch \`${fontFamily}\` from Google Fonts.")` and `// Emit font file to .next/static/media`.
- The 8 hashed weights are emitted to `apps/web/.next/static/media/*-s.woff2` and that dir is **gitignored** (`git check-ignore` → IGNORED). So a fresh clone has no fonts until a build runs.
- Therefore a cold clone / air-gapped CI runner with **no outbound network during `next build`** will **fail the build** with `nextFontError`. The commit message says the runtime IP leak to Google is eliminated — true — but it silently relocated that network dependency to **build time** and made it a hard build blocker offline.

This directly contradicts the WS3 "cold clone offline" concern in the mandate. The previous `<link>` approach failed *gracefully* (font just fell back at runtime); `next/font` fails the *build*.

**Fix:** document the build-time network requirement in SELF_HOSTING / WS3, OR pre-download + commit the woff2 and use `next/font/local`, OR provide `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` for offline CI. At minimum, note it.
**Disposition: ACCEPT (defer the local-font migration; document now).**

### 1c. SURVIVES — CSP still allows everything the app needs

`curl -s -D - http://localhost:3000/auth` returns:
```
connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321
font-src 'self' data:
img-src 'self' data: blob: https:
```
- Supabase REST/storage (`http://127.0.0.1:54321`) and realtime websocket (`ws://127.0.0.1:54321`) are both in `connect-src` — derived correctly from `NEXT_PUBLIC_SUPABASE_URL` (`next.config.mjs:5-13`).
- Self-hosted fonts live at `/_next/static/media/*.woff2` (same-origin) — covered by `font-src 'self'`.
- Served HTML has **0** `fonts.googleapis`/`fonts.gstatic` references (grep → empty). The external `<link>` tags are gone.
No CSP regression. The `<html>` carries `__variable_0d7163 __variable_3c557b` and `layout.css` maps `--font-dm-sans: '__DM_Sans_…', '__DM_Sans_Fallback_…'` — so the variable plumbing is correct; only the `.font-sans` override (1a) defeats it on body.

---

## TARGET 2 — Theme `--muted` contrast fix (globals.css)

I recomputed WCAG 2.1 relative-luminance contrast for **every** `--muted` value against **every** surface it actually lands on (sidebar, panel, surface, app-bg, right-panel, sidebar-hover), derived from a component audit (`text-[var(--muted)]` appears 47× across 12 files; LeftSidebar root is `bg-[var(--sidebar)]`, the right inspector `<aside>` is `bg-[var(--right-panel)]`, empty states sit on those container bgs, message timeline on `--surface`).

### 2a. SURVIVES — the two changed values genuinely pass AA on the surfaces that matter

| theme | --muted (new) | min ratio across real surfaces | verdict |
|---|---|---|---|
| solarized-light | `#4e646b` | 5.10:1 (on `--sidebar`/`--right-panel` #eee8d5) | PASS (panel 6.01, app-bg 5.80) |
| one-dark-pro | `#9ca3af` | 5.51:1 (on `--app-bg`/`--surface` #282c34) | PASS (panel/sidebar 6.06) |

The commit's "before" numbers are accurate (verified): solarized `#586e75` on `#eee8d5` = 4.39:1; one-dark `#7f848e` on `#282c34` = 3.73:1 — both were sub-AA. The new values clear AA on all real surfaces. No regression to the other 5 themes from these two edits.

### 2b. LOW — pre-existing transient sub-AA: dark-modern/github-dark `--muted` on `--sidebar-hover`

| combo | ratio |
|---|---|
| dark-modern `#9d9d9d` on `--sidebar-hover #3e3e42` | **3.93:1** |
| github-dark `#8b949e` on `--sidebar-hover #21262d` | 4.95:1 (passes) |

The dark-modern case is < AA. **But** every `bg-[var(--sidebar-hover)]` in the codebase co-occurs with `hover:text-[var(--text)]` (LeftSidebar:304,321,426,438; RoomHeader:240) — i.e. on hover the text color ALSO switches to `--text`, so `--muted` is never *statically* painted on `--sidebar-hover`; it's only a sub-second transition artifact while both `transition-colors` animate. WCAG 1.4.3 evaluates rendered states, so this is borderline-informational, not a stable failure. Not introduced by this commit.
**Disposition: DEFER (note it; tighten dark-modern `--muted` to ~#a5a5a5 if you want the transition clean).**

### 2c. SURVIVES — no `--muted-on-accent` usage regressed

`--muted` is never used as text on `--accent`/`--accent-strong`/`--user-bubble`. The `isDeleted` message bubble (`MessageBubble.tsx:227`) uses `--muted` on `--surface` (not user-bubble): solarized 5.80:1, one-dark 5.51:1 — both pass. The user-bubble always pairs with `--user-text`, never `--muted`.

---

## TARGET 3 — WS2 credential UI (ProvidersPanel.tsx + credentials routes)

### 3a. SURVIVES — the secret never reaches the browser

- `GET /api/credentials` selects only `METADATA_COLUMNS = 'id, provider, label, base_url, is_default, created_at, updated_at'` (`route.ts:19,31`) — `secret_ciphertext`/`secret_nonce` are never in the projection — and maps each row to `{ ...c, has_secret: true }` (`:37`). No ciphertext, no nonce, no plaintext leaves the server.
- `POST` response is `{ ...created, has_secret: true }` where `created` is again `METADATA_COLUMNS` only (`:98,102`). The plaintext `secret` is request-only.
- Client state: `secret` lives only in a controlled `<input type="password" autoComplete="off">` (`ProvidersPanel.tsx:159-168`), is cleared on success (`setSecret('')` :88), and is never written back from any server response. No `console.log`, no error message echoes it (errors use `json.error?.message`, server-generated). The form never re-displays a stored secret — truly write-only.

### 3b. SURVIVES — CSRF / same-origin on both mutating routes

- `POST` (`route.ts:41-42`) and `DELETE` (`[id]/route.ts:DELETE`) both call `assertSameOrigin(req)` first.
- `isForbiddenCrossOrigin` (`origin.ts:47-67`) rejects mutating cookie requests with a **missing** Origin (`if (!origin) return true`, :60) and any Origin not in the allowlist; Bearer-authed requests are correctly exempt (a cross-site page can't set `Authorization`). This is a genuine CSRF guard, not a no-op.
- DELETE is owner-scoped: `.eq('id', params.id).eq('user_id', user.id)` (`[id]/route.ts`) → a user cannot delete another's credential, returns 404 if no row matched.

### 3c. SURVIVES — input validation

`createCredentialSchema` (`api-validation.ts:172-184`): provider is an enum, label 1–80, secret 1–8000, `base_url` is `.url()` + forced `https://` (SSRF/mixed-content guard), `is_default` boolean. POST also gates on `hasCredentialKey()` (503 if `CREDENTIAL_ENCRYPTION_KEY` unset) and rate-limits per user.

### 3d. SURVIVES — credential-crypto is genuinely server-only

The `d67b23f` "every page 500'd (UnhandledSchemeError)" fix holds: `@agentroom/shared/credential-crypto` is imported ONLY by the credentials route (server), `bridge/src/lib/resolve-runtime-provider.ts`, and two bridge tests — never by `apps/web/components|contexts|hooks`. `commands.ts` (the barrel path that client code imports) has no `node:crypto` reference. `RuntimeCredential` is a bare `interface` in `index.ts:407` (type-erased), so no runtime crypto leaks into the client bundle.

**Minor nit (LOW):** `has_secret: true` is hard-coded in both GET and POST rather than derived from the row. Every persisted row has a secret by construction (NOT NULL ciphertext), so it's accurate today — but if the schema ever allows a secret-less row it would lie. Cosmetic. **DEFER.**

---

## TARGET 4 — the a11y test harness itself (e2e/a11y.spec.ts)

### 4a. HIGH — the per-theme + Settings + authed-room a11y tests are DEAD in CI (silent skip)

The headline WS-UX claim of `d67b23f` — "authed axe now runs on the room page across ALL 7 themes + the Settings page" — is **true only on a local machine with `E2E_LIVE=1`, and never in CI**.

- `e2e/a11y.spec.ts:18`: `const IS_LIVE = Boolean(process.env.E2E_LIVE)`.
- The three new tests each begin with `if (!IS_LIVE) test.skip(...)`:
  - `:67-70` authenticated room page
  - `:87-88` "passes axe on all 7 themes"
  - `:106-109` authenticated Settings page
- `test.skip(true, ...)` reports the test as **skipped (green)**, not failed.
- CI never sets `E2E_LIVE`: in `.github/workflows/e2e.yml` the `E2E_LIVE: '1'` line is **commented out** (`:51-54`), and a repo-wide grep for an uncommented `E2E_LIVE: '1'` across `.github` returns **nothing**. `ci.yml` does not run Playwright at all.

**Consequence:** the only a11y tests that actually run in CI are the two unauthenticated `/auth` scans (`:43`, `:54`). Those render `light-modern` only (default `:root`) on the auth page — they never exercise the 6 other themes, the room page, the right inspector, the empty states, or the Settings/Providers surface. **A future `--muted` or theme regression (exactly the class of bug `d67b23f` was fixing) ships through CI unnoticed.** The fix that "surfaced 2 real AA failures" can only ever surface them on a developer's laptop who remembers to run `E2E_LIVE=1`.

**Fix:** promote the Tier-2 block in `e2e.yml` (start Supabase + seed + create E2E user, set `E2E_LIVE: '1'`) so the authed/per-theme/Settings scans actually gate CI. The scaffolding TODO is already written in the workflow; it just isn't enabled. Alternatively, until then, downgrade the claim in the commit/report to "runs locally only."
**Disposition: ACCEPT.**

### 4b. SURVIVES (conditionally) — when they DO run, the tests are real, not no-ops

If `E2E_LIVE=1`: the all-7-themes test iterates `THEMES`, sets `document.documentElement.dataset.agentroomTheme`, waits 120ms for repaint, runs `AxeBuilder.withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()`, and fails on any `serious`/`critical` violation (axe's `color-contrast` rule is `serious`, so it IS gated). The assertion `expect(failures).toEqual([])` would genuinely fail on a contrast regression. So the harness logic is sound — the defect is purely that CI never turns it on (4a).

**Caveat (informational):** axe only flags contrast on text nodes that are actually rendered. A combo like `--muted` on `--sidebar` is only scanned if those elements are visible in the seeded room. If the seed has no empty states (rooms exist, pins/agents present), some `--muted`-on-container-bg combinations the audit found could still escape even a live run. Recommend a dedicated component/Storybook contrast snapshot, or assert empty states render, to fully cover the 47 `--muted` sites.

---

## Summary

- **1 Critical:** brand DM Sans does not paint on body text — `.font-sans` (0,1,0) overrides the `body` element rule (0,0,1); the headline "fonts now render" is false for UI body text.
- **1 High:** the per-theme / Settings / authed-room a11y tests are silently skipped in CI (`E2E_LIVE` never set) — theme/contrast regressions ship unnoticed.
- **1 Medium:** `next/font/google` introduces a hard build-time fetch to `fonts.gstatic.com`; cold/offline clone fails the build (WS3).
- **2 Low + nits:** transient dark-modern `--muted`-on-sidebar-hover 3.93:1; cosmetic hard-coded `has_secret`.
- **Survives:** CSP completeness, the two changed contrast values, the entire WS2 credential UI security model (write-only secret, CSRF, owner-scoping, validation, server-only crypto), and the a11y test *logic* (it just isn't wired into CI).
