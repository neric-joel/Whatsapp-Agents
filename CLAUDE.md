# AgentRoom — Project Memory
# Last updated: 2026-05-09
# Current phase: 8 (NEXT)

---

## 1. Project Identity

AgentRoom is a WhatsApp/Slack-style group chat where LLMs are named,
visible participants. One human message fans out to all active agents
in the room; each agent replies independently as a separate chat participant.

GitHub: git@github.com:neric-joel/Whatsapp-Agents.git

MVP success condition (from spec):
> A user creates a group room, adds multiple LLM agents, sends one message,
> and sees each active agent reply as a separate participant.

---

## 2. Locked Stack

| Layer             | Decision                                    | Status |
|-------------------|---------------------------------------------|--------|
| Frontend          | Next.js App Router + TypeScript + Tailwind  | LOCKED |
| Backend           | Next.js Route Handlers                      | LOCKED |
| Database          | Supabase PostgreSQL                         | LOCKED |
| Realtime          | Supabase Realtime (Postgres changes)        | LOCKED |
| Auth              | Supabase Auth                               | LOCKED |
| File Storage      | Supabase Storage (day-to-day)               | LOCKED |
| Large Files       | Google Cloud Storage (overflow/archive)     | LOCKED |
| Agent Execution   | Separate Node.js TypeScript Bridge Daemon   | LOCKED |
| Work Queue        | agent_runs table in Supabase (no Redis MVP) | LOCKED |
| Local Dev         | Supabase CLI + Docker                       | LOCKED |
| Package Manager   | pnpm workspaces (monorepo)                  | LOCKED |
| Build Orchestrator| Ruflo (MCP + swarm + RAG memory)            | LOCKED |

---

## 3. Monorepo Structure

```
agentroom/                    ← repo root (Whatsapp-Agents.git)
  apps/
    web/                      ← Next.js app (frontend + route handlers)
  bridge/                     ← Bridge Daemon (separate Node.js process)
  packages/
    shared/                   ← TypeScript types shared by web + bridge
  supabase/                   ← migrations, seeds, supabase config
  CLAUDE.md                   ← this file (committed to git)
  .gitignore
  pnpm-workspace.yaml
  package.json
```

---

## 4. Core Architecture Flow

```
Browser (chat UI)
│
│  Supabase Auth + Supabase Realtime subscriptions
▼
Supabase
├── Postgres (rooms, agents, messages, agent_runs, tool_calls, files, pinned_items)
├── Realtime (broadcasts new messages and run status to browser)
├── Auth (user sessions)
└── Storage (file attachments)
│
│  agent_runs table — status: 'queued'  ← THIS IS THE QUEUE
▼
Bridge Daemon (separate Node.js TypeScript process)
├── Polls for agent_runs with status = 'queued'
├── Claims a run: queued → claimed → running
├── Builds ContextPacketV1 for the agent
├── Invokes the correct CLI adapter
├── Streams output / writes partial messages
├── Saves final agent reply to messages table
├── Updates agent_runs: running → completed / failed / cancelled
└── Sends heartbeat while running
│
│  stdin / stdout / process control
▼
Local Agent CLIs
├── Claude Code CLI   → claude-code-adapter.ts
├── Codex CLI         → codex-adapter.ts
├── Ruflo             → ruflo-adapter.ts  (Phase 8)
├── Mock Agent        → mock-agent-adapter.ts  (Phase 5 testing)
└── [future]          → any CLI-based model
```

Write-path rule: Browser → Next.js Route Handler → Supabase rows → Bridge.
The browser NEVER writes directly to agent_runs or messages.

---

## 5. Orchestration Model

### Ruflo — Build Orchestrator
Ruflo (github.com/ruvnet/ruflo) is a Claude Code multi-agent platform
with 98 specialized agents, 311+ MCP tools, swarm intelligence, RAG memory,
and a native knowledge graph plugin.

In this project, Ruflo serves two distinct roles:

Role A — Build Orchestrator (from Day 1):
  - ruflo-rag-memory: stores and retrieves phase state across sessions
  - ruflo-swarm: coordinates Claude + Codex as a two-agent swarm
  - ruflo-intelligence: routes tasks intelligently based on phase
  - ruflo-knowledge-graph: builds/updates the project entity graph

Role B — AgentRoom Participant (Phase 8+):
  - Ruflo is wired as a live agent inside the product via ruflo-adapter.ts
  - provider: "ruflo" | adapter_type: "subprocess"
  - Ruflo's swarm intelligence makes it the most powerful room participant
  - It receives ContextPacketV1 and returns AgentResponseV1 JSON

### Claude — Session Orchestrator
At every session start:
  1. Read CLAUDE.md from repo root
  2. Query Ruflo memory for current phase + blockers
  3. Confirm phase and resume without asking human for context

Per phase:
  1. Read phase spec from AgentRoom_MVP_Build_Spec_v1.3.md
  2. Generate the exact Codex /do prompt for that phase
  3. Wait for human to run /do and return output
  4. Review output against acceptance criteria
  5. Run graphify on changed files
  6. Store result in Ruflo memory
  7. Update CLAUDE.md phase tracker
  8. Commit CLAUDE.md to git: "chore: update CLAUDE.md — phase N complete"
  9. Issue Phase N+1 prompt

### Codex — Builder
  - Receives /do prompts from the human
  - Implements ALL product code inside the repo
  - After each phase, commits with: "feat: phase N — <phase name>"
  - Pushes to main branch

### Graphify — Knowledge Graph Visualizer
  - Runs after EVERY phase via the graphify-windows skill
  - Input: all new/changed TypeScript files + migration SQL for that phase
  - Output: agentroom_graph_phase_N.html
  - Saved to: D:\What's app Agents\Intial plan\What's app agents\
  - NOT committed to git (in .gitignore)
  - Purpose: visual proof of correct architecture, entity map for future sessions

### Human — Approver
  - Runs /do <codex prompt> commands
  - Approves phase completions
  - Resolves blockers escalated by Claude

---

## 6. The /do Build Loop

For every phase, the loop is:

  1. Claude reads phase N spec → generates Codex prompt
  2. Human runs: /do <exact prompt>
  3. Codex executes inside repo root, commits "feat: phase N — <name>"
  4. Claude reviews output against acceptance criteria (listed per phase below)
  5. If PASS: Claude runs graphify → stores in Ruflo memory → updates CLAUDE.md → issues Phase N+1
  6. If FAIL: Claude generates a targeted fix prompt → human runs /do again → repeat from step 3

---

## 7. Environment Variables (locked — never change these names)

### apps/web/.env.local
```env
NEXT_PUBLIC_SUPABASE_URL=https://luoinocpxvoloulbqdfd.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<see .env.local — never commit>
SUPABASE_SERVICE_ROLE_KEY=<see .env.local — never commit>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### bridge/.env
```env
SUPABASE_URL=https://luoinocpxvoloulbqdfd.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<see bridge/.env — never commit>
BRIDGE_WORKER_ID=bridge-local-1
BRIDGE_POLL_INTERVAL_MS=2000
BRIDGE_MAX_CONCURRENT_RUNS=3
BRIDGE_HEARTBEAT_INTERVAL_MS=5000
BRIDGE_STALE_RUN_TIMEOUT_MS=60000
```

CRITICAL NAMING RULE:
  USE:    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  NEVER:  NEXT_PUBLIC_SUPABASE_ANON_KEY  (deprecated, will break auth)

---

## 8. Phase Status Tracker

| Phase | Name                        | Status   | Git commit                         | Graphify output                |
|-------|-----------------------------|----------|------------------------------------|--------------------------------|
| 0     | Repo scaffold               | DONE ✅  | feat: phase 0 — repo scaffold      | agentroom_graph_phase_0.html   |
| 1     | Supabase schema + seed      | DONE ✅  | feat: phase 1 — supabase schema + seed | agentroom_graph_phase_1.html ✅ |
| 2     | Shared types                | DONE ✅  | feat: phase 2 — shared types       | agentroom_graph_phase_2.html ✅ |
| 3     | API route handlers          | DONE ✅  | feat: phase 3 — api route handlers | agentroom_graph_phase_3.html   |
| 4     | Basic UI                    | DONE ✅  | feat: phase 4 — basic ui           | agentroom_graph_phase_4.html ✅ |
| 5     | Mock bridge daemon          | DONE ✅  | feat: phase 5 — mock bridge daemon | agentroom_graph_phase_5.html ✅ |
| 6     | Realtime polish             | DONE ✅  | feat: phase 6 — realtime           | —                              |
| 7     | Mentions + loop guard       | DONE ✅  | feat: phase 7 — mentions and loop guard | —                         |
| 8     | Real adapters (+ ruflo)     | NEXT ▶   | —                                  | —                              |
| 9     | Files, pins, tool approvals | PENDING  | —                                  | —                              |
| 10    | Hardening                   | PENDING  | —                                  | —                              |

---

## 9. Per-Phase Acceptance Criteria

### Phase 0 — Repo scaffold
  ✓ pnpm install completes with zero errors from repo root
  ✓ pnpm dev:web starts Next.js on port 3000 (shows default page)
  ✓ pnpm dev:bridge starts and logs "Bridge Daemon starting..."
  ✓ pnpm typecheck passes with zero TypeScript errors
  ✓ apps/web/.env.example and bridge/.env.example exist with correct key names
  ✓ git commit "feat: phase 0 — repo scaffold" visible in git log

### Phase 1 — Supabase schema + seed
  ✓ supabase db reset succeeds
  ✓ All 8 tables exist: rooms, agents, room_members, messages, agent_runs,
    tool_calls, files, pinned_items
  ✓ room_members CHECK constraint enforced (test with bad insert)
  ✓ Realtime publication includes: messages, agent_runs, tool_calls,
    files, pinned_items
  ✓ Seed data loads: 3 agents, 1 room, 3 room_members
  ✓ is_room_user_member() function exists

### Phase 2 — Shared types
  ✓ packages/shared/src/index.ts exports all types
  ✓ Both apps/web and bridge resolve @agentroom/shared without error
  ✓ pnpm typecheck passes
  ✓ ContextPacketV1, AgentResponseV1, AgentAdapter interface all exported

### Phase 3 — API route handlers
  ✓ GET /api/health returns { ok: true, data: { service: "agentroom-web" } }
  ✓ POST /api/rooms creates a room and inserts creator as owner
  ✓ POST /api/rooms/[roomId]/messages inserts message + creates one
    agent_runs row per active unmuted agent with reply_enabled=true
  ✓ All endpoints return standard { ok, data } or { ok, error } envelope
  ✓ Unauthorized requests return 401

### Phase 4 — Basic UI
  ✓ Room list renders in LeftSidebar
  ✓ Clicking a room loads MessageTimeline
  ✓ ComposeBox sends POST /api/rooms/[roomId]/messages on submit
  ✓ New message appears in timeline after send (optimistic or via refetch)
  ✓ AgentRunCard visible for queued runs (mock data acceptable)

### Phase 5 — Mock bridge daemon
  ✓ Sending a user message creates agent_runs rows
  ✓ Bridge picks up queued runs within BRIDGE_POLL_INTERVAL_MS
  ✓ Bridge atomically claims runs (no double-claim)
  ✓ Bridge inserts one agent reply per run into messages
  ✓ agent_runs.status → completed for all mock runs
  ✓ Claude Thinker reply starts with "I think we should..."
  ✓ Codex Builder reply starts with "I can implement..."
  ✓ Reviewer reply starts with "I see a potential risk..."

### Phase 6 — Realtime
  ✓ New messages appear without page refresh
  ✓ AgentRunCard status updates live (queued → running → completed)
  ✓ No duplicate messages appear from simultaneous fetch + realtime

### Phase 7 — Mentions + loop guard
  ✓ @claude_thinker in message creates run only for Claude Thinker
  ✓ @everyone creates runs for all active unmuted agents
  ✓ Agent reply does NOT create new runs beyond mentioned agents
  ✓ System message appears when round_index >= max_agent_rounds

### Phase 8 — Real adapters
  ✓ SubprocessAdapter base class exists with AbortSignal support
  ✓ ClaudeCodeAdapter invokes claude CLI, streams stdout
  ✓ CodexCliAdapter invokes codex CLI, streams stdout
  ✓ RuFloAdapter invokes ruflo CLI, passes ContextPacketV1 via stdin
  ✓ All adapters yield AgentEvent union — no direct Supabase writes
  ✓ Invalid JSON output from CLI is wrapped as visible_message

### Phase 9 — Files, pins, tool approvals
  ✓ Signed upload URL generated and usable
  ✓ File metadata saved to files table after upload
  ✓ Pin created from MessageBubble action
  ✓ Pinned items appear in RightInspector PinnedItemsPanel
  ✓ ToolCallCard shows approve/deny for waiting_approval status
  ✓ Bridge waits for approval before executing protected tool

### Phase 10 — Hardening
  ✓ All route handler request bodies validated with zod
  ✓ pnpm typecheck passes with zero errors
  ✓ Bridge logs include: timestamp, worker_id, run_id, status on every event
  ✓ Stale run recovery works on bridge restart
  ✓ Denylist blocks: rm -rf, format, shutdown, DROP TABLE patterns
  ✓ UI shows empty states for: no rooms, no messages, no agents in room
  ✓ Failed run shows error card in MessageTimeline

---

## 10. 8 MVP Tables (reference)

rooms | agents | room_members | messages | agent_runs | tool_calls | files | pinned_items

NO additional tables in MVP. No workspaces, profiles, billing, marketplace.

---

## 11. Git Discipline

Branch: main
Commit format per phase: "feat: phase N — <phase name>"
CLAUDE.md update commit: "chore: update CLAUDE.md — phase N complete"
.gitignore must include: node_modules/, .env, .env.local, .next/,
  dist/, supabase/.temp/, agentroom_graph_*.html

---

## 12. Workflow Status

Planning:            COMPLETE ✅
Stack:               LOCKED ✅
GitHub repo:         READY ✅ (git@github.com:neric-joel/Whatsapp-Agents.git)
Ruflo:               INSTALLED ✅ (plugin install — MCP RAG memory pending session restart)
Graphify:            READY ✅ (runs via graphify-windows skill)
Codex:               READY ✅ (receives /do prompts)
CLAUDE.md:           ACTIVE ✅ (this file, committed to git)
Obsidian Memory:     CONFIGURED ✅ (see Section 14 — vault notes seeded for phases 0-2)

---

## 13. Blockers Log

| Date       | Blocker                                              | Status   |
|------------|------------------------------------------------------|----------|
| 2026-05-08 | Ruflo installed as plugin; MCP RAG memory tools not  | PENDING  |
|            | visible in claude mcp list this session. Retry after |          |
|            | session restart with `claude mcp add ruflo` Option B.|          |
| 2026-05-08 | Obsidian API key exposed in chat — must regenerate   | PENDING  |
|            | Obsidian → Settings → Local REST API → Regenerate    |          |
|            | key, then update .mcp.json in repo root.             |          |

---

## 14. Obsidian Memory Layer

Obsidian serves as Claude Code's persistent cross-session memory, reducing
token usage by storing compact phase notes instead of re-reading source files.

### Three-Layer Memory Stack

  Layer 1 — CLAUDE.md (this file, git-committed, always loaded)
    └─ Phase tracker, env vars, architecture, acceptance criteria

  Layer 2 — Obsidian Vault (local, queryable via REST API)
    └─ Per-phase completion notes, graph summaries, decision log
    └─ Vault path: AgentRoom/ folder in your Obsidian vault
    └─ Setup guide: D:\What's app Agents\Intial plan\What's app agents\AgentRoom_Obsidian_Memory_Setup.md

  Layer 3 — Graphify HTML (local, visual)
    └─ D:\What's app Agents\Intial plan\What's app agents\agentroom_graph_phase_N.html

### MCP Config (.mcp.json in repo root)

  {
    "mcpServers": {
      "obsidian": {
        "command": "npx",
        "args": ["-y", "mcp-obsidian"],
        "env": {
          "OBSIDIAN_API_KEY": "<your-regenerated-key>",
          "OBSIDIAN_HOST": "http://127.0.0.1:27123"
        }
      }
    }
  }

  IMPORTANT: Regenerate Obsidian API key before filling this in.
  Old key was exposed in chat on 2026-05-08.

### Session Start Protocol (updated)

  1. Read CLAUDE.md (this file)
  2. curl -s -H "Authorization: Bearer $OBSIDIAN_KEY" \
       http://localhost:27123/vault/AgentRoom/_PROJECT.md
  3. Read latest phase note from Obsidian phases/ folder
  4. Confirm current phase, resume without re-reading source

### Post-Phase Protocol (updated — runs after every PASS)

  1. ✅ Verify acceptance criteria against Codex output
  2. 🔷 Run graphify-windows skill on changed files
  3. 📝 Write phase completion note to Obsidian:
       curl -X PUT -H "Authorization: Bearer $OBSIDIAN_KEY" \
         -H "Content-Type: text/markdown" --data-binary @- \
         http://localhost:27123/vault/AgentRoom/phases/phase-N-name.md
  4. 📝 PUT updated _PROJECT.md to Obsidian (update phase tracker row)
  5. 📄 Edit this CLAUDE.md — update phase tracker table
  6. 💾 git commit CLAUDE.md: "chore: update CLAUDE.md — phase N complete"
  7. ➡️  Issue Phase N+1 /do prompt

### Obsidian Vault Structure

  AgentRoom/
    _PROJECT.md                  ← master index (seeded ✅)
    phases/
      phase-0-scaffold.md        ← seeded ✅
      phase-1-schema.md          ← seeded ✅
      phase-2-shared-types.md    ← seeded ✅ (update to DONE after phase 2 passes)
      phase-3-api-handlers.md    ← write after phase 3 passes
      ...
    architecture/
      data-flow.md               ← seeded ✅
      schema-overview.md         ← seeded ✅
      env-vars.md                ← seeded ✅
    decisions/
      stack-locked.md
