# PRODUCTION_READINESS.md — audit (working artifact; deleted before the final PR)

Repo @ `main` v1.1.0 (`597155f`). Goal: clean, public, newcomer-proof.

## Branches

**Keep:** `main`, `internal/build-tooling` (snapshot), `chore/production-ready-cleanup` (this work).

**Merged into `main` → DELETE (local; + remote where present):**
`chore/pre-v1-verification-and-ship-kit`, `chore/repo-cleanup-and-demo`, `docs/v1.0.0-finalize`,
`feat/collab-and-output-hardening`, `feat/product-validation-v1`, `fix/pre-v1-agents-rls-and-realtime`,
`harden/p5-dx-docker-onboarding`, `harden/p6-edge-logger-split`, `harden/p6-observability-reliability`,
`harden/p7-docs-oss`, `harden/p8-release-scaffold`, `harden/p9-agent-memory`, `harden/p10-agent-to-agent`,
`harden/p11-commands-user-agents`, `harden/stress-chaos-v1`, `release/v1.1.0`.

**NOT merged → KEEP (never delete unmerged work):** `archive/p11-unpushed-2026-05-31`,
`backup/pre-pivot-2026-05-30` (intentional snapshots); `feat/p1-security`, `harden/p0-baseline-hygiene-ci`,
`harden/p0-foundation`, `harden/p2-quality`, `harden/p3-tests`, `harden/p4-ux-a11y` (old phase tips with
diverged local commits — content largely on `main` via their PRs, but tips unmerged → leave for the owner).

**Remote:** the merged campaign/feature branches above are safe to delete on `origin`; **dependabot PRs
(#19–#38) are OPEN → keep.** Branch model going forward: trunk-based (`main` + short-lived feature
branches) → document in CONTRIBUTING.

## Dead code — Ruflo + myclaude (REMOVE both)

| Adapter | Files | Seed agent? | Tests? | Verdict |
|---|---|---|---|---|
| **ruflo** | 15 (adapter, registry case, `AGENT_PROVIDERS`/`AGENT_ADAPTER_TYPES`, `resolve-runtime-provider`, `provider-styles`, `subprocess-security`, `RUFLO_BIN`, docker-compose, Dockerfile, start-agentroom.bat, shared types, README/SECURITY/ARCHITECTURE/SELF_HOSTING) | **none** | **none** | **REMOVE** — never exercised; its old "build-orchestrator" role lived in the now-removed `CLAUDE.md`; an unframed-subprocess surface. |
| **myclaude** | 11 (adapter, registry case, enum, `resolve-runtime-provider`, `MYCLAUDE_BIN`, Dockerfile, start-agentroom.bat, README/SECURITY/ARCHITECTURE/SELF_HOSTING) | **none** | **none** | **REMOVE** — same rationale (owner said apply the same test). |

`knip` is clean (both are imported by `registry.ts`, so static analysis sees them as "used" — the
real signal is no seed + no test = never run). **Project actually runs:** `claude-code`/`subprocess`
(Claude) + `codex-cli` (Codex) + `mock`. Keep credential providers `openai` + `custom` (BYO). ADR:
`docs/adr/0012-remove-unused-ruflo-myclaude-adapters.md`.

## Docs (already lean — light consolidation)

Public set is essentially the target already: `README` (307, **rewrite — Step 5**), `QUICKSTART` (37),
`SELF_HOSTING` (223), `ARCHITECTURE` (228), `OBSERVABILITY` (145, keep — distinct ops job), `CONTRIBUTING`
(101), `SECURITY` (62), `CODE_OF_CONDUCT` (61), `CHANGELOG` (133), `docs/adr/` (13, history; has a README
index). `.github/` issue+PR templates fine. Work: scrub Ruflo/myclaude refs, fix cross-links, ensure the
ADR index lists 0012, trim any insider-context. No doc needs cutting/merging beyond that.

## Install path (what a newcomer must do)

Prereqs: Node 22.13+, pnpm 11+, Docker, Supabase CLI, + Claude/Codex CLIs for real agents (mock needs
none). Steps: copy `apps/web/.env.example`→`.env.local` and `bridge/.env.example`→`.env` (fill Supabase
keys from `supabase status`); `pnpm install`; `pnpm dev:supabase`; `pnpm db:reset`; `pnpm dev:web` +
`pnpm dev:bridge` (two terminals) — or `make bootstrap` (mac/Linux/WSL) / `start-agentroom.bat` (Windows).
README Quickstart must make this copy-pasteable + verifiable (health `db:up` + a mock reply). Verify on a
clean clone (Step 6).

## Next-prod-gaps (for the final report)
`next@14→15` (D3, deferred — `audit` allowed-red); per-theme authed Lighthouse; CI Tier-2 (authed e2e +
live discussion integration test); a hosted demo. Prioritize `next@15` (security advisories).
