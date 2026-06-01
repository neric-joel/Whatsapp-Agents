# Phase 1 Security — Critique Gate

- **Date:** 2026-05-30
- **Branch:** `feat/p1-security` (stacked on `harden/p0-foundation`)
- **Reviewers:** Security Auditor (lead) + adversarial Code Reviewer (`.claude` subagents)
- **Verdict:** **PASS** — no open Critical/High from either reviewer.

## Verification evidence
- `pnpm -r typecheck` — green (shared, bridge, web)
- `pnpm -r test` — **135 passing** (59 bridge node:test + 76 web vitest; +25 vs. the 110 baseline)
- `pnpm --filter web build` — Compiled successfully; middleware bundled
- Client bundle secret check — `grep SERVICE_ROLE apps/web/.next/static` → no matches (service-role key not in client bundle)
- Storage RLS verified against the live local DB in a rolled-back transaction — all 6 membership assertions pass; migration creates 4 policies and drops the 2 permissive ones cleanly

## Controls reviewed (both: SOUND)
1. **Subprocess** — `shell:false` unconditional; argv fully static; `system_prompt` delivered via stdin (regression test asserts injection payload never reaches argv); binary resolved from `*_BIN`/PATH only; `.cmd`/`.bat` routed via `cmd.exe /d /s /c` with static args; child env allowlisted (service-role key provably stripped; `BRIDGE_CHILD_ENV_ALLOW` cannot re-add a secret-pattern var); 10 MB output cap kills + errors.
2. **Storage RLS** — `is_room_file_member` fails closed on malformed/non-uuid/encoded-slash/null-byte/traversal inputs; binds to the literal room segment (no cross-room grant); UPDATE/DELETE policies added.
3. **CSRF** — mutating-only; missing-Origin rejected; exact-origin allowlist; Bearer exemption is safe (no cross-site custom header); enforced centrally in middleware + inline on the two hottest routes.
4. **Rate limiting** — fixed-window, keyed by authenticated user, after auth; single-instance limitation documented with a Redis upgrade path.
5. **Fail-closed middleware** — unauthenticated page requests redirect to `/auth`; API routes keep their own 401s; no redirect loop, no added latency (getUser already ran).
6. **Headers/CSP** — frame-ancestors none, HSTS, nosniff, Referrer-Policy, Permissions-Policy, object-src/base-uri/form-action locked; `unsafe-inline`/`unsafe-eval` is the documented App-Router tradeoff (nonce CSP → Phase 4).
7. **Error redaction** — all 16 5xx paths return a generic message; raw error logged server-side only. Validation 400s still return field-shape info by design.

## Findings and disposition
| ID | Sev | Finding | Disposition |
|----|-----|---------|-------------|
| M-1 | Med | `connect-src` had a blanket `https:` weakening the CSP exfil backstop | **Fixed** — scoped to `'self' <supabase> <wss>` |
| CR-1 | Med | Upload MIME allowlist mismatched ComposeBox `accept="*/*"` → confusing UX | **Fixed** — `accept` now mirrors the allowlist; clear client-side error for type/size |
| CR-2 | Med | Windows `.cmd` path containing spaces could mis-parse through cmd.exe | **Accepted** — Node's argv quoting wraps space-containing args; standard npm-global path works; documented constraint |
| CR-3 | Low | Rate-limit response used `CONFLICT` code | **Fixed** — added `RATE_LIMITED` code |
| L-1 | Low | Middleware matcher excludes `auth` as an unanchored prefix | **Deferred** — no current route exposure; tracked for Phase 2 cleanup |
| CR-4 | Low | CSP `wss:` empty if `NEXT_PUBLIC_SUPABASE_URL` absent at build | **Accepted** — app is non-functional without that var anyway |
| INFO | Low | system_prompt now rides the user turn, not the CLI `--system-prompt` role | **Accepted** — required to remove the argv injection surface |

No Critical/High. Phase 1 acceptance criteria met with linked evidence.
