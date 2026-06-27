# Memory & model interaction

How AgentRoom gives agents memory and coordinates how they take turns and talk to each
other. Researched against Cowork's project memory and current (2026) multi-agent
context-management guidance, then mapped to what AgentRoom actually does.

## Research takeaways

- **Structured context objects beat full-history forwarding.** Passing every agent the
  whole transcript scales token cost quadratically with handoffs; the recommended pattern
  is a typed context object carrying only the relevant fields (200–500 tokens vs
  5,000–20,000). ([getmaxim.ai](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/), [Medium/Predict](https://medium.com/predict/context-management-for-ai-agents-the-definitive-guie-ad2c859fa5e9))
- **Context drift / memory loss is the dominant multi-agent failure mode** — not raw
  context exhaustion — so grounding + trimming matter more than a bigger window.
- **Cowork** keeps memory *within a project* across its sessions; instructions are baked
  into the workspace. ([support.claude.com](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork))

## Memory in AgentRoom

- **Recallable memory** (`agent_memory` table). Facts/preferences/skills/episodic notes,
  scoped `global` (cross-room) or `room`. The user writes them with `/remember` (and reads
  with `/recall`); agents can emit `memory_op` control events that the bridge persists as
  DATA (never as instructions — memory can't override the system prompt or escalate tools).
- **Recall ranking** (`bridge/src/memory/recall.ts`): a local LIKE match over the query
  ranked by recency + confidence + pin state (decision D7 — FTS5 is a later option). The
  top entries are injected into `ContextPacketV1.memory` as quoted DATA. The `MemoryPanel`
  shows them in the room's right rail.
- **Grounding as durable memory** (Phase A): `environmentFacts()` injects the *real*
  architecture into every prompt, so agents stay accurate about the app over time instead
  of re-hallucinating it. The **canary** (Phase D) then stops a wrong claim from becoming
  another agent's remembered "fact".
- **Session scope** (Phase B): rooms carry `session_id`, so memory is naturally
  partitioned by working context. (Today memory is keyed by room/global; session-keyed
  recall is the documented next step now that the link exists.)

## Model interaction

- **The context packet is the structured context object.** `ContextPacketV1`
  (`build-context-packet.ts`) carries exactly: the environment grounding, the agent's
  persona, a **trimmed** recent-message window (`trimContextMessages` + per-message char
  caps + a count limit), the peer **roster** (name/slug/capability — not full transcripts
  of peers), recalled memory, and attached files. This is the token-efficient pattern the
  research recommends, not full-history forwarding.
- **Windowing.** The recent-message window is bounded by count + per-message chars; the
  admin `/reset` stamps a `context_reset_at` watermark so agents see a fresh window while
  the transcript stays intact.
- **Turn-taking.** A human message fans out to active, unmuted agents per the room
  `reply_mode` (`everyone` vs mention-only). `@slug` / `@everyone` route to specific
  agents. In `/discuss` (ADR-0011) the coordinator decomposes the task and assigns tag
  turns; each phase's agents see their teammates' contributions on a shared blackboard
  (the discussion-scoped query), with an anti-sycophancy dissent stage.
- **When agents reply to each other.** Gated by `allow_agent_to_agent` and the mention
  path; an agent reply only spawns further runs for the agents it explicitly addresses.
- **Loop guards.** `max_agent_rounds` and `max_agent_hops` cap depth; a system message is
  posted when the cap is hit, so agent-to-agent chains terminate. The canary's propagation
  gate adds a *quality* guard on top of these *quantity* guards.

## Where this leaves us

AgentRoom already follows the recommended structured-context + trimmed-window design and
has recallable memory + grounding. The trust additions in v2 (grounding + canary) directly
target the dominant failure mode the research names — context drift / a wrong "fact"
propagating — which is the point of this whole effort.
