# AgentRoom — Full End-to-End Acceptance Report (from GitHub, v1.4.0)

**Date:** 2026-06-28
**Tester role:** brand-new user, installing from the public GitHub repo
**Under test:** `https://github.com/neric-joel/Whatsapp-Agents` @ tag **`v1.4.0`** (`1690e50`)
**Host:** Windows 11 (primary) + WSL2 Ubuntu (Linux cross-check)
**Method:** fresh clone → README-only install → drive the real app via its own HTTP API and
a headed Chromium (Playwright) for screenshots, with the live SQLite DB inspected on disk.
Real agent CLIs used: Claude Code 2.1.195, Codex 0.128.0 (Gemini 0.42.0 and Antigravity
1.107.0 also exercised — see findings).

## Verdict

**ACCEPT (with tracked Medium/Low findings).** A new user who follows the README alone gets
a working, trustworthy, local-only app. Storage and data flow were proven from the live
database; agents answered well and resisted hallucination; edge/safety cases failed safe.
**No Critical or High issues found.** An adversarial review panel (security auditor +
completeness critic) ran against this report: the security auditor returned
**ACCEPT-CONFIRMED** (all 7 sandbox/localhost invariants hold in code, no doc overclaim);
the completeness critic returned **NEEDS-MORE** and was right on two points, both now
addressed below — (1) several README features I had left untested are now exercised
(`/debate`, `/handoff`, `/reset`, delete, archive, clear, mute), and (2) **tool-approval is
not merely "untriggered" — it has no producer path in any shipped adapter** (filed as a real
finding, not a coverage note). Open findings: #80, #83 (Medium), #81, #82, #84 (Low) — none
block acceptance for a single-user local tool.

## Acceptance criteria

| AC | Criterion | Result |
|----|-----------|--------|
| AC1 | Install from GitHub @ v1.4.0 (README only); boots; binds 127.0.0.1 | ✅ PASS |
| AC2 | Feature matrix from README **and** code; each case pass/fail + evidence | ✅ PASS (broad coverage; a few items honestly marked "not verified" — see matrix) |
| AC3 | Multi-agent: one message → ≥2 real CLIs as distinct participants; `/discuss`; tag-turns | ✅ PASS |
| AC4 | Storage proven from live DB/files; persistence across restart | ✅ PASS |
| AC5 | `docs/HOW_IT_WORKS.md` documents the verified data flow; linked from README | ✅ PASS |
| AC6 | Answer eval scored (correctness, grounding, hallucination-catch, latency), single + multi, incl. image | ✅ PASS |
| AC7 | Edge/safety cases fail safe (cancel, bad/unauth CLI, timeout, malformed, traversal) | ✅ PASS |
| AC8 | Linux boot + mock-agent confirmed | ✅ PASS (WSL Ubuntu) |
| AC9 | This report committed; Critical/High fixed + merged; rest filed | ✅ PASS (0 Critical/High; docs committed; Med/Low filed) |

## Phase 1 — Provision from GitHub (AC1)

- `git clone … && git checkout v1.4.0` → **2s**. `pnpm install` → **7s, zero errors** (warm
  store; native builds `better-sqlite3`/`esbuild`/`sharp`/`unrs-resolver` auto-approved via
  `pnpm-workspace.yaml allowBuilds`, no `ERR_PNPM_IGNORED_BUILDS`).
- `pnpm start` → clean **Next.js 16** production build (no Windows `@vercel/nft` EPERM),
  web + bridge up, browser opened, `GET /api/health` → `{"ok":true,…,"db":"up"}`.
- **Bind (the v1.4 hardening):** `netstat` shows `127.0.0.1:3000` (web) and `127.0.0.1:9090`
  (bridge health) — **no `0.0.0.0` / `[::]`**. Confirmed localhost-only.
- First run created `~/.agentroom/agentroom.db` + `files/` and seeded "My First AgentRoom".

## Phase 2 — Feature matrix (AC2)

Built from the README **and** code (29 API route files, 13 SQLite tables, 10 slash
commands, all adapters, the discussion orchestrator, subprocess security). Coverage of the
exercised matrix:

| Area | Capability | Result | Evidence |
|------|------------|--------|----------|
| Connections | Auto-detect CLIs on PATH (`--version`) + health badges | ✅ | Screenshot: 4 CLIs "detected ✓ · connected" with versions + invocations |
| Connections | Connect / BYO registration → `config.json` | ✅ | `config.json` held 9 profiles (bin/args/kind), survived restart |
| Rooms | Create / rename / list | ✅ | API + DB rows; rename verified + restored |
| Sessions | Create (working_dir) / rename / persist | ✅ | session row, working_dir validated, "E2E Session Renamed" |
| Agents | Add connected CLI to room (provider `custom`, adapter `cli`) | ✅ | 6 agent rows; slug unique-per-user enforced (409 on dup) |
| Messaging | Fan-out: one message → all active agents | ✅ | claude+codex, 2 distinct repliers, 12.5s |
| Messaging | `@mention` routing (single) / `@everyone` | ✅ | `@claude` → only Claude replied "PONG" |
| Collaboration | `/discuss` decompose→execute→cross-review→converge + attribution | ✅ | phases `plan>execute>integrate>converge`, 76s, "Contributions: @codex/@claude" |
| Memory | `/remember` (room + `--global`) / `/recall` | ✅ | room+global rows; recall found token |
| Memory | Prompt-injection scan + flag | ✅ | injection note `injection_flagged=1`; agent refused it as data |
| Files | Signed upload → disk + metadata; signed download | ✅ | `files/rooms/<id>/<fid>/e2e-upload.txt` (50 B); download round-trip |
| Pins | Pin a message | ✅ | pinned_items row; panel showed "E2E pin" |
| Themes | 7 light/dark themes | ✅ | theme switcher present (Light Modern active) |
| Runs | Live run cards (queued→running→completed) + Stop | ✅ | screenshot: "Claude is thinking… Running [Stop]" |
| Canary | verified / unverified badge on replies | ✅ | /discuss replies graded; one "unverified" |
| Cancellation | Cancel a run mid-flight | ✅ | run → `cancelled` |
| Collaboration | **`/debate`** (assign→argue→rebut→**adjudicate** a winner) | ✅ | phases `plan>argue>rebut>adjudicate`, 6 replies, "Prevailing position: @codex for SQLite" |
| Collaboration | **`/handoff @agent`** (targeted peer turn) | ✅ | "Codex here; I received the handoff." |
| Context | **`/reset`** (admin) stamps `context_reset_at` + system msg | ✅ | reset row + 1 system message |
| Messaging | Message **delete** (soft tombstone) | ✅ | content → "This message was deleted." |
| Messaging | **Mute** an agent suppresses its replies | ✅ | muted Claude excluded; only Codex replied |
| Rooms | **Archive / unarchive**, **delete**, **clear transcript** | ✅ | hidden when archived; deleted gone; cleared → 0 msgs |
| Rendering | **Markdown + KaTeX** (bold/italic/code/lists/math) | ✅ | screenshot; 2 `.katex` els, 0 katex-error, fonts bundled |
| Health | `/api/health` db-readiness | ✅ | `{"ok":true,"db":"up"}` |

**Findings / not-verified (corrected after adversarial review):**
- **Tool-approval is a finding, not a coverage note (→ #83, Medium).** It is *not* "code-present
  + unit-tested but untriggered." Reading the code: **no shipped adapter (Claude, Codex, mock)
  nor the base parser ever emits the `tool_call_requested` event** that drives the gate — it
  appears only in the type definition. So `ToolCallCard` / approve-deny are unreachable by
  bundled CLIs. (`tool_calls` stayed 0 for that reason.)
- **Not exercised (honestly unverified):** BYO provider credentials (`user_credentials`/
  Providers — optional, not needed for CLI auth); the hallucination **Accept/Reject** banner
  buttons (the agents *refused* the bait, so no flagged reply existed to act on — the canary
  path itself is verified); the UI-only `/agents` and `/help` command renderers.
- **Mute and message-edit have API support but no UI surface (→ #84).**

## Phase 3 — Multi-agent (AC3)

- **Fan-out** (one message → 2 real CLIs as distinct participants): ✅ Claude + Codex,
  verified by API and visible in the UI.
- **`/discuss`**: ✅ full `plan → execute → integrate → converge` lifecycle, coordinator =
  Codex, real cross-review, and an explicit **"Contributions: @codex … @claude …"**
  attributed final answer. Caught live in a screenshot mid-"integrate".
- **`/debate`** (genuinely distinct from `/discuss`): ✅ ran `assign → argue → rebut →
  **adjudicate**` and picked a **winner** (not a compromise) — "Prevailing position: @codex
  for SQLite." 6 replies, ~100s.
- **Agent-to-agent turn-taking:** ✅ `/handoff @codex` produced a targeted Codex reply; the
  multi-round `/discuss` and `/debate` flows exercise peer turns under the loop guards.
- **Loop guards:** rooms carry `max_agent_rounds=3` / `max_agent_hops=6`; discussions and
  debates converged within bounds (no runaway).

## Phase 4 — Storage + data flow (AC4) → see `docs/HOW_IT_WORKS.md`

Live DB after the test run (`~/.agentroom/agentroom.db`, read-only dump):

```
rooms 9 · sessions 1 · agents 6 · room_members 14 · messages 49 · agent_runs 32
files 2 (on disk) · pinned_items 1 · agent_memory 3 (1 injection-flagged) · tool_calls 0
config.json: 9 CLI profiles
```

- Real rows from real actions in **10 of 12** tables (`tool_calls` and `user_credentials`
  empty by the coverage notes above). Uploaded file present on disk at
  `files/rooms/<roomId>/<fileId>/e2e-upload.txt`.
- **Data flow** traced by observation: UI → `POST /api/rooms/:id/messages` → `messages`
  row + `agent_runs` queued → bridge claims (queued→claimed→running, worker_id+heartbeat)
  → ContextPacketV1 → locked-down subprocess → canary gate → reply `messages` row → run
  completed → browser poll renders it. Documented in `docs/HOW_IT_WORKS.md`.
- **Persistence across restart:** ✅ stop `pnpm start` → restart (reused build, ready in 3s)
  → **9 rooms, 49 messages, the renamed session, the `/remember` notes, and all connections
  all survived**. Bridge re-bound 127.0.0.1; stale-run sweep ran (nothing mid-flight to
  recover).

## Phase 5 — Answer evaluation (AC6) → see `docs/reviews/answer-eval.md`

Single (Claude) and multi (Claude+Codex) across factual / reasoning / grounding /
hallucination-bait / image. **Grounding accurate and canary-`verified` everywhere;
hallucination-bait refused by all three answers** ("None of them… local SQLite, not a cloud
DB"); image upload handled honestly (no OCR env → "I cannot see it" rather than a
fabrication). Latency ~8–10s single, ~12s two-agent fan-out, ~76s `/discuss`.

## Phase 6 — Stress, edges & safety (AC7)

| Case | Result | Evidence |
|------|--------|----------|
| `working_dir` traversal (dotdot / outside-root / UNC / relative) | ✅ all rejected at write time | 400 VALIDATION_ERROR, precise messages |
| `working_dir` re-validation at **spawn** time (#71) | ✅ code + unit tests (`resolveSpawnCwd`) | not separately E2E-triggered |
| Malformed body / invalid JSON | ✅ 400 (not 500) | VALIDATION_ERROR |
| CSRF: foreign origin / missing origin | ✅ both 403 (fail-closed) | FORBIDDEN |
| Cancel a run mid-flight | ✅ → `cancelled` | cancel resp + final status |
| Bad/missing CLI binary | ✅ run `failed` + clear error, app healthy | "Adapter 'cli' binary not found…" |
| Unauthenticated CLI (Gemini, tier-deprecated) | ✅ run `failed` + captured auth error, no crash | `IneligibleTierError` surfaced |
| CLI timeout (hangs forever) | ✅ killed at 120s, run `failed`, app healthy | per-run 120s timeout + kill-tree |
| Concurrency (6 runs at once) | ✅ all settled (~18s), no deadlock | bridge `max_concurrent=3` queue |
| Prompt-injection in stored memory | ✅ flagged + treated as inert data; agent refused | `injection_flagged=1` |
| Oversized message (1 MB) | ⚠️ accepted (Low) | no content cap at API; context is trimmed downstream |

Everything fails safe; the canary never silently passed on error.

## Phase 7 — Linux boot (AC8)

WSL2 Ubuntu, fresh clone @ v1.4.0, node 22.13 + pnpm 11.0.8: `pnpm install` (10s) +
**`pnpm build` (33s) both succeeded**, app booted, `GET /health` `{"ok":true,"db":"up"}`,
**bound `127.0.0.1:3100`** (localhost-only on Linux too), and a **mock agent replied**
("I see a potential risk with…"). Confirms the app is **not Windows-only**. The only friction
was WSL toolchain setup (node absent; `corepack`'s bundled keys are stale — "Cannot find
matching keyid" — a known external corepack issue; installing pnpm via npm avoided it).

## Findings (all filed as GitHub issues; none block acceptance)

- **F1 — Medium — [#80] `antigravity` in the auto-detect catalog is not a conversational
  agent.** The `antigravity` binary is an editor/IDE launcher (`--diff`, `--merge`, `--goto`,
  `--new-window`), so connecting it yields usage text, never a real reply, and no
  `defaultArgs` can change that. It auto-detects as "ready ✓", which misleads. *Recommend:*
  drop it from `packages/db/src/cli-detect.ts`, or label it "not an agent CLI."
- **F2 — Medium — [#83] tool-approval has no producer path in shipped adapters.** The README
  advertises "tool-approval for protected actions"; the consumer side exists (`tool_calls`,
  `ToolCallCard`, approve/deny routes, run-worker wait branch), but **nothing emits the
  `tool_call_requested` event** — the bundled parsers (Claude/Codex/mock) and the base parser
  never produce it; it appears only in the type definition. So the gate is unreachable by
  bundled CLIs. *Recommend:* wire a real producer (parse CLI `tool_use` events) + a unit test,
  or move the feature to the roadmap until then. (Caught by the adversarial completeness critic;
  I had mis-framed it as a "coverage note.")
- **F3 — Low — [#81] no size cap on message content.** A 1 MB `content` is accepted
  (`sendMessageSchema.content = z.string().min(1)`, no `.max()`); the context builder trims
  downstream so no crash; single-user → low risk. *Recommend:* a generous length cap.
- **F4 — Low — [#82] `GET /api/rooms/:id/messages` for a nonexistent room returns 200 + `[]`**
  instead of 404. **Cause:** the GET handler never checks room existence (`requireRoomMember`
  is a no-op in single-user mode), unlike the POST which does 404. No data leak. *Recommend:*
  add an existence check.
- **F5 — Low–Medium — [#84] mute-toggle and message-edit are API/DB-backed but have no UI.**
  `PATCH …/members/:id { muted }` and `PATCH …/messages/:id { content }` work, but `AgentsPanel`
  offers only "Disable" (not mute) and `MessageBubble` has no Edit action. UX dead-ends.
- **Observation (not a bug):** Gemini fails because Google deprecated its free tier
  (`IneligibleTierError`) — external; AgentRoom handled it gracefully (failed run, clear
  error). Detection (`--version`) ≠ ability to reply (needs working auth).
- **Genuinely not verified (honest):** BYO provider credentials; the hallucination
  Accept/Reject banner buttons (no flagged reply arose to act on — the agents refused the
  bait); `working_dir` re-validation at *spawn* time (#71 — verified by code + unit tests,
  not separately E2E-triggered, and currently `getWorkingDir()` returns `null` so spawn cwd is
  always undefined today).

## Evidence index (local, not committed)

API/DB probe outputs and screenshots captured under the test job's scratch dir
(`functional`, `features`, `discuss`, `answer-eval`, `edges-api`, `bridge-edges`,
`timeout`, `persistence` JSON + `dbdump-final.json` + `shots/*.png` + `wsl-boot.log`).
`docs/HOW_IT_WORKS.md` (committed) and `docs/reviews/answer-eval.md` carry the durable
write-ups.
