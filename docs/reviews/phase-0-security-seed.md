# Security Auditor — Phase 0 (PRELIMINARY seed) — 2026-05-30

Verdict: PASS-WITH-FIXES (preliminary — full audit at the Phase 1 critique gate)
Assets used: `security-auditor` agent (local ~/.claude). Lead verifier: Principal Engineer (claims spot-checked against source).

> Scope: read-only seed of the highest-value, statically-observable risks for Phase 1
> triage. The exhaustive Phase 1 audit (with attempted bypasses) happens at the
> `/critique security` gate. Lead-verified items are marked ✔.

## Findings

- [SEV: High] Shell enabled for child spawn on Windows → command injection via agent `system_prompt` ✔ verified `subprocess-adapter.ts:27`
  - Where: `bridge/src/adapters/subprocess-adapter.ts:25-28` (`shell: process.platform === 'win32'`); arg source `claude-code-adapter.ts` (`args.push('--system-prompt', packet.agent.system_prompt)`).
  - Impact: On win32 (documented dev platform) Node serializes `args[]` back into a `cmd.exe` command line. A crafted `agent.system_prompt` (DB-stored data) with shell metacharacters (`&`, `|`, `^`, `"`, `%VAR%`) can execute arbitrary commands on the bridge host. The `args[]` protection only holds with `shell:false`.
  - Fix: `shell:false` unconditionally; resolve the binary path explicitly on Windows.
  - Phase: 1
- [SEV: High] No output-size cap on child stdout/stderr → memory DoS ✔ verified `subprocess-adapter.ts:34-35`
  - Impact: `stdoutLines`/`stderrLines` grow unbounded; a misbehaving local CLI exhausts bridge memory. Spec requires a max-output cap; none exists.
  - Fix: track cumulative bytes; kill child + error past a cap (1–5 MB); bound line length.
  - Phase: 1
- [SEV: Medium→High] Full `process.env` forwarded to child → service-role key leaks to agent CLIs ✔ verified (no `env` option on spawn)
  - Impact: Every spawned CLI inherits `SUPABASE_SERVICE_ROLE_KEY` (bypasses all RLS). A prompt-injected/ malicious CLI can exfiltrate it and write any table directly (breaks the core invariant).
  - Fix: pass an explicit minimal `env` allowlist; never forward the service-role key.
  - Phase: 1
- [SEV: Medium] `*_BIN` executables not allowlisted (`CLAUDE_BIN ?? 'claude'`, etc.)
  - Fix: validate against an allowlist of absolute paths; reject bare/relative names. Phase: 1
- [SEV: Medium] Child `cwd` never set/validated → agent CLIs run in the repo root ✔ verified (no `cwd` option)
  - Impact: code-capable agents can read/modify project files, `.env`, git history. Fix: explicit validated scratch `cwd`. Phase: 1
- [SEV: Medium] Denylist substring-match is bypassable and guards a stubbed exec path
  - Where: `bridge/src/lib/denylist.ts`; consumer `run-worker.ts:111-150` (execution is a stub returning `{ok:true}`).
  - Fix: defense-in-depth only; primary control = allowlist + human approval; normalize/tokenize; add tests; re-audit when real exec lands. Phase: 1
- [SEV: Medium] Supabase `error.message` returned verbatim to clients (schema/constraint disclosure)
  - Where: messages/rooms/members/agents/files routes via `apiError(..., error.message, 500)`. Fix: generic 5xx message + server-side log w/ run id. Phase: 1
- [SEV: Low] Any room member (not just admin) can add agents — `members/route.ts:39` uses `requireRoomMember` while DELETE uses `requireRoomAdmin`. Phase: 1
- [SEV: Low] Signed-upload trusts client `mime_type`/`size_bytes`; no MIME allowlist; relies on bucket 50MB guard. Phase: 1

## What held up (verified)
- ✔ Core invariant: RLS ON for all 8 tables (`initial_schema.sql:245-252`); **every policy is `FOR SELECT` only** (`:255-284`) → anon/authenticated default-denied for all writes incl. `agent_runs`. Browser uses publishable key; writes go through service-role route handlers.
- ✔ Key boundary: `SUPABASE_SERVICE_ROLE_KEY` only in `apps/web/lib/supabase/server.ts` (server-only, imports `next/headers`) + `bridge/src/lib/supabase.ts`; never in a `'use client'` component or `NEXT_PUBLIC_*`.
- ✔ No committed secrets (only blank `.env.example`).
- Subprocess timeout (120s), concurrency cap (`MAX_CONC`), stale-run recovery, orphan kill (SIGTERM→2s→SIGKILL), and atomic CAS claim are all enforced in code.

## Open questions / verify in Phase 1
- Phase9 storage `FOR INSERT` "authenticated users can upload" (`phase9_extensions.sql:54`): does its `WITH CHECK` enforce room membership, or can any authenticated user upload to `agentroom-files` directly via the storage API (bypassing the route handler)?
- "Image text → third-party API" threat: no OCR/egress code path found in-repo; `extracted_text` is read in `build-context-packet.ts` but nothing populates it. Confirm where extraction happens / what leaves the host.
- Runtime: do `claude`/`codex`/`ruflo` resolve to intended binaries on this host (PATH/CWD hijack risk while `shell:true`)?
