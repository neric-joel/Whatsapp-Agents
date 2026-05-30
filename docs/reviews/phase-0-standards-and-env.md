# DX & Standards Inventory — Phase 0 — 2026-05-30

Verdict: FAIL (for an OSS/production bar — expected at baseline)
Assets used: `Explore` agent (local). Lead-verified items marked ✔.

## Presence / absence
Missing (→ to add): `.github/workflows/`, `.github/dependabot.yml`, `.github/ISSUE_TEMPLATE/`,
`.github/pull_request_template.md`, `CODEOWNERS`, `Dockerfile(s)`, `docker-compose.yml`,
`.dockerignore`, `.devcontainer/`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`,
`CODE_OF_CONDUCT.md`, `CHANGELOG.md`, **root `README.md`**, root ESLint config, Prettier
config, `.editorconfig`, `.nvmrc`/`.node-version`, `docs/ARCHITECTURE.md`, `docs/adr/`,
`docs/SELF_HOSTING.md`, `docs/reviews/` (now created).
Present: `CLAUDE.md`, `docs/production-hardening/`, per-package `tsconfig.json`, `pnpm-workspace.yaml`.

## Findings
- [SEV: High] `launch-agentroom.ps1:1` hardcodes `$REPO="D:\What's app Agents\Whatsapp-Agents"` ✔ verified (no secret) → derive from `$PSScriptRoot`. Phase 0/5
- [SEV: High] No CI / CODEOWNERS / PR+issue templates. Phase 0
- [SEV: High] Missing LICENSE/CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/CHANGELOG/README. Phase 0/7
- [SEV: Medium] No ESLint/Prettier/editorconfig. Phase 0(min)/2(unify)
- [SEV: Medium] No `.nvmrc`/`.node-version`. Phase 0
- [SEV: Medium] No Dockerfile/compose/devcontainer. Phase 5
- [SEV: Medium] TS `strict:true` set in all 3 tsconfigs ✔, but no `noUncheckedIndexedAccess`/`noUnusedLocals`; no shared base. Phase 2
- [SEV: Info] `NEXT_PUBLIC_APP_URL` in `apps/web/.env.example` but unused in code. Phase 2

## Env-var reality table (✔ all live vars documented; no undocumented vars; no secrets)
| var | read at | in .env.example? | status |
|-----|---------|------------------|--------|
| NEXT_PUBLIC_SUPABASE_URL | web/lib/supabase/{client,server}.ts | ✓ | GOOD |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | web/lib/supabase/{client,server}.ts | ✓ | GOOD |
| SUPABASE_SERVICE_ROLE_KEY | web/lib/supabase/server.ts; bridge/src/lib/supabase.ts | ✓ both | GOOD |
| NEXT_PUBLIC_APP_URL | (not read in code) | ✓ web | ORPHAN |
| SUPABASE_URL | bridge/src/lib/supabase.ts | ✓ | GOOD |
| BRIDGE_WORKER_ID | bridge index/run-worker | ✓ | GOOD |
| BRIDGE_POLL_INTERVAL_MS | bridge/index | ✓ | GOOD |
| BRIDGE_MAX_CONCURRENT_RUNS | bridge/index | ✓ | GOOD |
| BRIDGE_HEARTBEAT_INTERVAL_MS | bridge/index | ✓ | GOOD |
| BRIDGE_STALE_RUN_TIMEOUT_MS | bridge/index | ✓ | GOOD |
| CLAUDE_BIN / CODEX_BIN / MYCLAUDE_BIN / RUFLO_BIN | bridge/src/adapters/*.ts | ✓ | GOOD |
