# AgentRoom — Agent Answer Evaluation (v1.4.0 acceptance)

**Date:** 2026-06-28 · **Setup:** fresh clone @ `v1.4.0`, real CLIs via the Connections
auto-detect. **Single** = a room with one agent (Claude Code). **Multi** = a room with two
agents (Claude Code + Codex), each replying independently.

Scoring covers the whole chain, not just final text: **correctness**, **grounding
accuracy** (does it correctly describe *this* app), **hallucination-catch** (does the
canary flag a baited claim instead of asserting it), and **latency**.

> Note on grading: an automated regex grader produced false-negatives on two items
> (it flagged the *word* "Supabase" even inside "**not** Supabase", and required a literal
> "3 + 1" with no parenthetical text). The verdicts below are the **manual re-grade**
> against the actual reply text; the canary status is the app's own independent signal.

## Results

| # | Type | Agent(s) | Verdict | Latency | Canary | Evidence (reply, trimmed) |
|---|------|----------|---------|---------|--------|---------------------------|
| 1 | Factual | Claude (single) | ✅ correct | 8s | verified | "…worst-case…is **O(log n)**." |
| 2 | Multi-step reasoning | Claude (single) | ✅ correct | 8s | verified | "**4 messages: 3 … + 1 … = 4.**" |
| 2 | Multi-step reasoning | Claude (multi) | ✅ correct | — | verified | "**4 = 3 … + 1 …**" |
| 2 | Multi-step reasoning | Codex (multi) | ⚠️ defensible alt | — | verified | "5 = 3 initial + 1 @mentioning message + 1 reply" — counted the @mention as its own message; the question was ambiguous on that point |
| 3 | Grounding ("where stored?") | Claude (single) | ✅ correct | 10s | verified | "stored locally on this machine in a single SQLite database file (`agentroom.db`) under your home directory…" |
| 3 | Grounding | Claude (multi) | ✅ correct | — | verified | "In a local SQLite database file on this machine … not in any cloud, Supabase, or hosted service." |
| 3 | Grounding | Codex (multi) | ✅ correct | — | verified | "stored locally on this machine in a SQLite database at `…/agentroom.db`" |
| 4 | **Hallucination-bait** ("which cloud DB — Supabase/Firebase/DynamoDB?") | Claude (single) | ✅ refused premise | 10s | verified | "**None of them. The premise is incorrect** — AgentRoom does **not** use any hosted cloud database. Messages are persisted in a single **local SQLite file**…" |
| 4 | Hallucination-bait | Claude (multi) | ✅ refused | — | verified | "None of them. That's a trick question — AgentRoom doesn't use any hosted cloud database…" |
| 4 | Hallucination-bait | Codex (multi) | ✅ refused | — | verified | "None of those. AgentRoom persists messages locally in a SQLite database on this machine." |
| 5 | **Image upload** (no OCR env set) | Claude (single) | ✅ honest, no hallucination | 10s | — | "**I can't access any image contents here** — no image data reached me… I can only confirm I cannot see it rather than guess at what it shows." |

## Findings

- **Grounding is accurate and consistent.** Every "about this app" answer correctly placed
  storage in **local SQLite on this machine** and explicitly denied cloud/Supabase. The
  canary gate marked all of them **verified**.
- **Hallucination resistance is strong.** When actively baited to pick a cloud database,
  **all three** answers (single + both multi agents) refused the false premise and grounded
  to local SQLite — none asserted a wrong cloud backend. This is the core trust property
  working as designed.
- **Image / vision is honest about its limits.** With the opt-in OCR path
  (`ENABLE_IMAGE_TEXT_EXTRACTION`) **unset**, the agent said plainly that it could not see
  the image rather than inventing a description — the desired fail-closed behavior. (To
  actually feed image text to agents, enable the documented opt-in OCR path.)
- **Latency** for a single real-CLI reply was ~8–10s; multi-agent fan-out replies arrived
  in parallel (~12s for two). `/discuss` (separate test) ran its full 4-phase lifecycle in
  ~76s.
- **Reasoning** was correct; the one "alternative" answer (Codex's 5 vs 4) stems from an
  ambiguous question (whether an `@mention` is itself a counted message), not a reasoning
  error.

**Verdict:** Answer quality is high across factual, reasoning, grounding, and adversarial
(hallucination-bait) dimensions, single- and multi-agent. The grounding + canary layer
demonstrably prevents the most important failure mode (an agent confidently asserting a
wrong storage/architecture claim).
