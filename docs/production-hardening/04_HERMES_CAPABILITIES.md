# 04 — Hermes-Inspired Capabilities (Supabase-without-Pro + Phases 9–11)

This is the design spec for the capability work that layers **on top of** the
hardening phases (0–8). It is sequenced **after the security foundation** (phases
0–3) because memory writes and agent hand-offs are injection/abuse surfaces that must
sit on RLS + the tool-approval flow — exactly as Hermes scans memory entries for
prompt injection.

Reference model: **Hermes Agent** (NousResearch, MIT) — persistent agent-curated
`MEMORY.md`/`USER.md`, a central `COMMAND_REGISTRY` with admin/user permission tiers
shared across chat surfaces, and a judge-gated `/goal` loop. We adopt the patterns,
adapted to AgentRoom's Supabase/multi-room model. Sources at the end.

## Hermes → AgentRoom mapping

| Hermes | AgentRoom adaptation |
|--------|----------------------|
| `MEMORY.md` (agent-curated, add/replace/consolidate) | `agent_memory` table, agent emits memory ops, bridge validates + scans |
| `USER.md` (model of the user) | `user_profile` table, consented, injected into context |
| Memory injection scanning | Scan + sanitize every memory write; stored memory is **data, never instructions** |
| FTS5 cross-session recall | Postgres full-text search (GIN/tsvector) over memory + room history |
| `/goal` judge loop (Ralph loop) | `/goal` + `/loop` Claude Code workflow commands (see `claude-commands/`) |
| `COMMAND_REGISTRY`, admin/user split | In-product command registry keyed on `MemberRole` (owner/admin/member) |
| `/handoff` cross-surface | `/handoff @agent` agent-to-agent delegation within a room |
| Shared slash commands (CLI + messaging) | Same registry powers parsing in `mention-parser.ts` |

---

## Workstream A — Run without Supabase Pro (amends Phase 5 + Prerequisites)

**Problem:** the project's env doc points at a hosted free-tier Supabase project,
which pauses after inactivity and is rate-limited — the "unreliable" experience.

**Target:** local Supabase via Docker is the **default** for dev and solo use; a
self-hosted Docker path is the production option. No Pro plan, ever.

**Tasks**
- Make `pnpm dev:supabase` (local `supabase start`, already supported) the documented
  default path end to end (README, QUICKSTART, launchers).
- Add a **self-hosted production** option: a `docker-compose` that runs the
  Supabase stack (or plain Postgres + GoTrue + Storage) alongside web + bridge, using
  the existing `supabase/migrations` + `seed.sql`. Document promoting local → prod.
- Demote hosted/cloud to an **optional** appendix; if used, document the free-tier
  pause behavior and a keep-alive/health note so it degrades gracefully.
- Boot-time env validation (zod) names any missing/invalid var and points at the
  local-Docker default. `.env.example` files stay authoritative.
- Recall (Phase 9) uses **Postgres full-text search**, which local Docker Postgres
  provides out of the box — no Pro, no external service. `pgvector` is an optional
  later upgrade for semantic recall.

**Acceptance:** a clean clone reaches a working app using only local Docker Supabase
(no cloud account); env validation fails fast with a clear message; docs never
require a paid plan.

---

## Phase 9 — In-product agent memory (Hermes-style, Postgres FTS)

**Goal:** agents persist and recall knowledge across rooms and sessions, curating
their own memory the way Hermes does — safely.

### Data model (new migration, additive)
- `agent_memory`
  - `id`, `agent_id` (FK), `room_id` (FK, nullable → `scope='global'` when null),
    `scope` (`'global' | 'room'`), `kind` (`'fact' | 'preference' | 'skill' | 'episodic'`),
    `title`, `content`, `source_message_id` (nullable), `confidence` (0–1),
    `pinned` (bool), `is_active` (bool), `created_at`, `updated_at`,
    `search_tsv` (generated `tsvector` from title+content).
  - Index: GIN on `search_tsv`.
- `user_profile`
  - `id`, `user_id` (FK), `summary` (text/markdown — the `USER.md` analog),
    `details` (jsonb), `consented` (bool, default false), `updated_at`.
  - Agents read it only when `consented = true`.

### Behavior
- **Curation:** after a run, an agent may emit memory operations via a new
  `AgentEvent` variant: `{ type: 'memory_op'; op: 'add'|'replace'|'consolidate';
  scope; kind; title; content; target_id? }`. The bridge **validates, injection-scans,
  and persists** them — the agent never writes the DB directly (preserves the
  "browser/agent never writes tables directly" invariant).
- **Consolidation:** when an agent's active memory for a scope exceeds a cap, run a
  consolidation pass (merge/replace stale entries) — agent-proposed, bridge-applied.
- **Injection safety (mandatory):** scan every memory `content` for
  instruction-injection patterns before storing; store sanitized text; mark its
  provenance. Injected context is rendered to agents as **quoted data, never as
  instructions**, and can never escalate tool permissions or override the system
  prompt. (This is the Hermes "security scanning on memory entries" requirement.)
- **Recall:** extend `ContextPacketV1` with
  `memory?: { agent: MemoryEntry[]; user?: UserProfileSummary }`, retrieved by
  Postgres FTS ranked against the trigger message + recent messages, capped and
  token-budgeted. Add the type to `packages/shared`.

### In-product surface
- `/remember <text>` — user stores a memory (scope defaults to room; `--global` opt).
- `/recall <query>` — FTS over the room/agent memory, rendered in a panel.
- A Memory panel (reuse the panel pattern of `PinnedItemsPanel`) to view/pin/forget.

### Security / RLS
- RLS on both tables via the existing `is_room_user_member()` god function; global
  memory readable only to the owning agent's rooms; `user_profile` gated on
  `consented`. Memory writes flow only through the bridge service role.

### Tests / acceptance
- Memory op round-trips (add/replace/consolidate) with RLS enforced.
- An injection payload stored as memory does **not** alter agent behavior or
  permissions in a follow-up run (red-team test must fail to escape).
- Recall returns relevant entries via FTS and respects the token budget.
- `/remember` + `/recall` work end to end with the right role gating.

---

## Phase 10 — First-class agent-to-agent interaction

**Goal:** agents know who else is in the room, what they're good at, and can hand off
work — building on what already exists (`allow_agent_to_agent`, `reply_mode`,
`max_agent_rounds`, `max_agent_hops`, `reply_policy`, `/discuss`, tag-turn loop
guards).

**Tasks**
- **Roster + capabilities in context:** add `agents.capabilities` (short text/persona
  blurb) and inject a `roster` into `ContextPacketV1`: the other room agents with
  `name`, `slug`, and capability blurb — so each agent can address peers deliberately
  rather than blindly. (Add the field to `packages/shared`.)
- **Hand-off protocol:** new `AgentEvent` variant
  `{ type: 'handoff_requested'; to_agent_slug; reason; payload? }`. The bridge creates
  a **targeted** `agent_run` for the named agent, subject to the existing loop guards
  (`allow_agent_to_agent`, `max_agent_hops`, `max_agent_rounds`) plus **cycle
  detection** on the hand-off chain. Surfaced to users as `/handoff @agent <task>`.
- **`/agents`** — list room agents, their capabilities, and active runs (reuse
  `ActiveRunsPanel` + `agent_runs`).
- **Loop-guard hardening:** prove hops/rounds are enforced (Phase 1/3 tests), add a
  deterministic cap + visible "deliberation ended (hop limit)" system message.
- **Document the protocol** in `docs/ARCHITECTURE.md`: discussion phases, tag-turns,
  hand-offs, and the loop-guard math.

**Acceptance:** an agent can hand a sub-task to a named peer; the chain terminates
under the hop/round caps (no infinite loops, proven by a test); `/agents` reflects
reality; the roster appears in the context packet.

---

## Phase 11 — In-product slash commands + command registry

**Goal:** a clean, permissioned, extensible slash-command surface for room users —
Hermes' `COMMAND_REGISTRY` pattern, adapted.

**Tasks**
- **Central registry** in `packages/shared`: each command = `{ name, description,
  argsSpec, minRole, surface, handler }`. Both the API and the parser read from it
  (single source of truth, like Hermes).
- **RBAC tiers** using the existing `MemberRole`: `owner` > `admin` > `member`;
  `/help` and `/commands` always allowed. Destructive/admin commands (e.g. room
  reset) require `admin`+.
- **Parser:** extend `mention-parser.ts` to detect a leading `/command` (coexisting
  with `@mentions` and the existing `/discuss`).
- **Command set (v1):** `/discuss` (exists), `/remember`, `/recall`, `/summarize`
  (summarize recent messages or a thread), `/handoff @agent`, `/agents`, `/pin`,
  `/personality @agent <name>` (per-room persona overlay), `/reset` (clear agents'
  rolling context for the room; admin+), `/help`, `/commands`.
- **Discoverability:** typing `/` shows available commands (filtered by the user's
  role), mirroring Hermes' `/` autocomplete and `/commands` browser.
- **Validation + safety:** every command validates input via the registry's argsSpec
  (extend `lib/api-validation.ts`); unknown/over-privileged commands are rejected with
  a friendly message. No command bypasses RLS or the tool-approval flow.

**Acceptance:** commands dispatch through one registry; role gating is enforced
server-side (a `member` cannot run an `admin` command); `/help` lists exactly the
caller's allowed commands; parser handles `/command`, `@mention`, and plain text
without regressions to existing tests.

---

## Sequencing & dependencies

```
Phase 0–3 (hygiene, security, quality, tests)  ──┐  must land first
Workstream A (local-Docker Supabase default)   ──┘  (amends prereqs + Phase 5)
        │
        ▼
Phase 9 (memory)  →  Phase 11 (commands surface /remember /recall)
        │                     │
        ▼                     ▼
Phase 10 (agent-to-agent)  →  /handoff /agents land in Phase 11 registry
        │
        ▼
Phase 4–8 UX/DX/observability/docs/release proceed in parallel worktrees,
then v1.0 includes the new capabilities in the Definition of Done.
```

Each phase still runs the full `/loop`: plan → implement → verify → `/critique`
(Security Auditor is mandatory for 9 and 10) → integrate → judge → `/ship`.

## Sources
- Hermes Agent — README (memory, skills, gateways, `/goal` loop): https://github.com/NousResearch/hermes-agent
- Hermes Agent — Slash Commands Reference (`COMMAND_REGISTRY`, `/goal`, `/handoff`, admin/user split): https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/slash-commands.md
- Hermes Agent docs: https://hermes-agent.nousresearch.com/docs/
- agentskills.io open skill standard: https://agentskills.io
