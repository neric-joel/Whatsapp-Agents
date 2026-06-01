# Product / UX / Hermes-credential Campaign — autonomous run

**Date:** 2026-06-01 · **Branch:** `feat/product-validation-v1` (stacked on PR #40 tip)
**Mode:** autonomous (owner asleep; decisions made via brainstorm/web-research + ADR).
`main` + `v1.0.0` untouched. Local gate green throughout.

## 1. Verdict — PARTIAL (honest)

**GO for:** WS1 core product (real Codex + Claude + mock agents work; MVP fan-out; multi-agent
`/discuss` convergence; RBAC) **and WS2** (Hermes-style BYO credential feature — built end to
end and security-proven). **NOT yet done:** WS1 breadth (full difficulty/file/command matrix),
**WS-UX** (7-theme axe, authed Lighthouse user-flow, responsive, screenshots), **WS3**
(cold-clone onboarding), and the WS2 "real reply from a registered provider" checkpoint
(needs a real provider API key — see Deferred). These are scoped + ready to resume.

## 2. Decisions Log (autonomous)

- **ADR-0010 — BYO credentials:** per-user keychain; AES-256-GCM at rest (vs Supabase Vault =
  v1.1); `agents.credential_id` binding; "owner brings the fuel"; per-adapter env injection.
- **Branch base:** off PR #40 tip (not bare `main`) so WS1 runs on the fixed bridge and WS2
  builds on the latest `subprocess-adapter`. Reversible; logged.
- **WS2 v1 scope:** the per-adapter API-key path (claude-code→ANTHROPIC_API_KEY,
  codex-cli→OPENAI_API_KEY+base_url) which the finalized `user_credentials` schema supports;
  arbitrary custom-CLI bin-path/env-var-name = v1.1 (schema has no columns for it).
- **`/debate`:** registered as a `/discuss` synonym (registry⇄dispatch parity).
- **Codex reply pollution:** non-JSON stdout lines dropped (they are process noise in `--json`).

## 3. Environment fingerprint

- Commit `73ebb99`; stack up (web :3000, bridge :9090, Supabase db :54322), canonically seeded.
- CLIs authenticated: `claude` 2.1.159, `codex` 0.128.0 ("Logged in using ChatGPT").
- `CREDENTIAL_ENCRYPTION_KEY` set on web+bridge (BYO feature live).
- Gate: typecheck ✓ · lint 0-err ✓ · format ✓ · **test 311** (web 154 + bridge 157, 1 POSIX-skip)
  · **pgTAP 30**. Real CLI calls spent: ~7/25.

## 4. Scorecard

| Area | Check | Verdict | Evidence |
|---|---|---|---|
| W1.1 | Room + agent create (API) + RBAC | **PASS** | 4-agent roster created; non-admin → 403 "Admin required"; tool_permissions forced {} |
| W1.2 | MVP fan-out (one msg → each replies once) | **PASS** | real Claude "2+2 equals 4."; found+fixed Codex reply pollution (live clean: "11 is prime.") |
| W1.4a | `/debate` registry⇄dispatch parity | **PASS (fixed)** | registered alias + parser passthrough; web slash-commands test |
| W1.5 | `/discuss` convergence | **PASS** | individual→critique→consensus, peer-referencing, bounded `round_index=3` |
| W1.x | difficulty matrix, file MIME, tool-approval, full command sweep | **PENDING** | core proven; breadth not yet exhaustively run |
| WS2 | schema + RLS + secret REVOKE | **PASS** | pgTAP user_credentials (6): owner-only, secret cols 42501, cross-user denied |
| WS2 | AES-256-GCM crypto | **PASS** | 5 unit tests (round-trip, nonce, wrong-key, tamper, key validation) |
| WS2 | runtime resolution + injection | **PASS** | resolver unit tests + e2e: injected key reaches child, base_url too |
| WS2 | credentials API (write-only secret) | **PASS (live)** | POST/GET/DELETE; encrypted at rest (stored_plaintext=f); no secret in response/logs |
| WS2 | agent binding (credential_id, owner-checked) | **PASS** | agents route verifies ownership before link |
| WS2 | Settings → Providers UI | **PASS** | /settings (auth-protected 307); add/list/delete; write-only secret; states + a11y labels |
| WS2 | real reply from a registered provider | **COULD-NOT-RUN** | no spare provider API key; host codex uses ChatGPT-login. Injection path proven by the e2e test instead. |
| WS-UX | 7-theme axe / authed Lighthouse / responsive / screenshots | **PENDING** | not started |
| WS3 | cold-clone onboarding | **PENDING** | not started (runs last) |

## 5. Multi-agent `/discuss` transcript (proof of convergence)

`/discuss "split a $1000 prize fairly when contributions differ"` →
- **individual:** Claude — "**My piece: the measurement layer.** Before we argue about formulas…"
- **critique:** Claude — "**On @ws1_mock_a's Shapley proposal — right instinct, wrong altitude.**"
- **consensus:** Claude — "## Final consensus … a floored, weighted-proportional method" (no @mention)
- loop guard: stopped at `round_index=3` (= `max_agent_rounds`), no runaway.

## 6. WS2 design + key-leak red-team evidence

Design: ADR-0010 + `docs/production-hardening/specs/2026-06-01-ws2-byo-cli-credentials.md`.
Red-team (all PASS): (1) **e2e** — a real spawned child receives the injected key + base_url,
while a `process.env` service-role secret is NOT forwarded; no-inject → absent. (2) **at rest**
— DB stores ciphertext+nonce, `stored_plaintext=f`. (3) **API** — GET returns metadata only.
(4) **logs** — the secret canary appears 0× in web/bridge logs. (5) **RLS pgTAP** — owner-only
reads, secret columns 42501 to the browser, cross-user denied, service-role decrypts.

## 7. UI/UX — PENDING (WS-UX)

The new Settings UI was built to the states/labels contract; the full WS-UX pass (per-theme
authed axe on all 7 themes, authed Lighthouse user-flow ≥95, responsive 320→1440, keyboard
walkthrough, before/after screenshots — ADR-0009 gates) is **not yet run**.

## 8. Fixes shipped / deferred

**Shipped (commits `7a16fd1`→`73ebb99`):** Codex reply pollution; `/debate` parity; the full
WS2 stack (foundation, crypto, inject seam, resolution+wiring, e2e red-team, API+binding+RLS,
Settings UI). **Deferred:** WS2 real-provider reply (needs a real key); WS1 breadth; WS-UX; WS3;
WS2 v1.1 (custom-CLI bin-path/env-name columns, Vault, key rotation, default-by-provider auto-resolve).

## 9. WS3 onboarding — PENDING (runs last).

## 10. Next `/goal`

Finish **WS-UX** (authed Lighthouse user-flow + per-theme axe + responsive + screenshots,
closing ADR-0009 gates), then **WS1 breadth** (difficulty/file/command matrices) and **WS3**
cold-clone onboarding; when a real provider key is available, run the WS2 real-reply checkpoint.
