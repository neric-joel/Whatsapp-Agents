# Code-Quality & Dead-Code Auditor — Phase 0 — 2026-05-30

Verdict: PASS-WITH-FIXES
Assets used: `code-reviewer` agent (local ~/.claude). Lead-verified items marked ✔.

## Findings
- [SEV: High] `apps/web/lib/api.ts` is dead (superseded by `api-error.ts`) ✔ verified exists/exports `ok,err`
  - Only `.worktrees/` copies import `{ok,err} from '@/lib/api'`; all 13 live route handlers use `apiSuccess/apiError` from `api-error.ts`. `git log`: `api.ts` from phase 3, `api-error.ts` from phase 10, callers never back-ported.
  - Fix: delete `apps/web/lib/api.ts` (re-confirm zero live importers at delete time). Phase: 0
- [SEV: High] `createRoomSchema.reply_mode` enum drift ✔ verified `api-validation.ts:6`
  - Schema `z.enum(['all','mentioned_only'])` but `ReplyMode='everyone'|'mentioned_only'` (`packages/shared/src/index.ts:141`), migration default `'everyone'`, seed `'everyone'`. Valid `'everyone'` → 400; accepted `'all'` matches nothing and pollutes the column (messages route only branches on `mentioned_only`).
  - Fix: `z.enum(['everyone','mentioned_only'])`. Phase: 0/2
- [SEV: Medium] Health route working-tree edit regresses the Phase-3 contract ✔ verified `health/route.ts:4`
  - Changed to `NextResponse.json({ ok:true })`; contract requires `{ ok:true, data:{ service:'agentroom-web' } }`.
  - Fix: restore via `apiSuccess({ service:'agentroom-web' })` (lets `api.ts` still be deleted). Phase: 0
- [SEV: Medium] Adapter registry taxonomy inconsistent with `AdapterType`; codex/ruflo unreachable; `myclaude` orphan
  - `AdapterType='subprocess'|'mock'` but `registry.ts` switches on `'claude-code'|'codex-cli'|'myclaude'|'ruflo'|'subprocess'|'mock'`; seed only sets `'subprocess'|'mock'`, and `'subprocess'`→`ClaudeCodeAdapter`, so Codex/Ruflo agents silently run as Claude.
  - Fix: route on `provider` (or widen `AdapterType` + fix seed); delete `myclaude-adapter.ts` unless planned. Phase: 2
- [SEV: Low] Web test imports bridge denylist via `../../../../bridge/src/lib/denylist` (`denylist.test.ts:2`) → move `isDeniedCommand`+patterns to `packages/shared`. Phase: 2
- [SEV: Low] Duplicated inline `ApiResponse<T>`/member-row types in `RoomAgentsPanel.tsx:19`, `useRooms.ts:7-8`, `AgentsPanel.tsx:12`; shared `ApiError` ({ok:false;error:string}) disagrees with runtime ({code,message}). Reconcile + import shared. Phase: 2
- [SEV: Low] `getRoomMembership` (`permissions.ts:4-23`) returns a `role` no caller reads. Phase: 2
- [SEV: Info] `.gitignore` misses `.worktrees/`, `graphify-out/`, `.claude/do-tasks/`; `.worktrees/` holds full repo copies that pollute scans. Phase: 0

## Verified NOT dead (load-bearing but obscure)
- `SubprocessAdapter` base + Claude/Codex/RuFlo subclasses (registered, well-factored — not over-abstraction).
- 3 Supabase client factories (browser/ssr vs cookie-server vs service-role daemon — genuinely different; do NOT merge).
- `AgentsPanel` (read-only sidebar) vs `RoomAgentsPanel` (add/remove modal) — distinct, both rendered.
- All hooks, components, and `app/api/**/route.ts` entrypoints — live consumers confirmed.
- `bridge/src/lib/redact.ts`, `logger.ts` — used in `run-worker.ts` + `index.ts`.

## Open questions
1. Is `myclaude` a real planned agent? If not, delete adapter + registry case + `MYCLAUDE_BIN`.
2. Canonical API error envelope: flat `{error:string}` or structured `{error:{code,message}}`? (They disagree today.)
3. Dispatch agents by `provider` rather than `adapter_type`?
