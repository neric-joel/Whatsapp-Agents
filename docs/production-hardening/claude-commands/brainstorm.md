---
description: Explore and design a feature before building (no code until approved)
argument-hint: <topic>
allowed-tools: Read, Grep, Glob, WebSearch, WebFetch
---

# /brainstorm — design before building

For new capability work (especially phases 9–11: memory, agent-to-agent interaction,
in-product commands) design before you implement. Topic: `$ARGUMENTS`.

HARD RULE: do not write code, scaffold, or change behavior until I approve a design.

## Steps

1. **Ground it** — read the relevant code and the spec in
   `docs/production-hardening/04_HERMES_CAPABILITIES.md`. Note what already exists
   (e.g. `allow_agent_to_agent`, `reply_mode`, loop guards, `/discuss`,
   `mention-parser.ts`) so you extend rather than duplicate.
2. **Clarify** — ask me focused questions (one topic at a time) on purpose,
   constraints, and success criteria. Prefer concrete options.
3. **Propose 2–3 approaches** with trade-offs and a recommendation.
4. **Present the design** in sections scaled to complexity: data model + migrations,
   interfaces/contracts (e.g. additions to `ContextPacketV1`), security (RLS +
   injection scanning), UX, and tests. Get my approval per section.
5. **Write the spec** to `docs/production-hardening/specs/<date>-<topic>.md`, then do
   a self-review (placeholders, contradictions, scope, ambiguity) and ask me to
   review before implementation.

When the design is approved, set it as a `/goal` and run `/loop`.
