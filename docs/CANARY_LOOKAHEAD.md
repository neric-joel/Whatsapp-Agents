# Canary lookahead — stopping hallucinations before they spread

In a multi-agent room, one agent's hallucination becomes another agent's premise and then
the human's "fact". We saw exactly this: asked where chat is stored, one CLI claimed
**Supabase Postgres** and another a **ChatGPT workspace service** — both wrong (it's local
SQLite). The canary is a **pre-commit gate** that screens an agent's reply *before* it is
saved and *before* it is fed to another agent.

Inspired by **HalluCana** (canary lookahead for hallucination, [arXiv:2412.07965](https://arxiv.org/abs/2412.07965)).

## Where it runs

```
agent CLI → final reply
   │
   ▼  runCanary(reply)              ← packages/shared/src/canary.ts (pure, deterministic)
   │     status: verified | unverified | flagged
   ▼
run-worker stamps message.metadata.canary = { status, reasons }   ← before the row is saved
   │
   ▼  build-context-packet → buildAgentPrompt
        a flagged/unverified peer reply is prefixed "[UNVERIFIED …]" when shown to the NEXT
        agent → a bad claim can't silently become a premise (the propagation gate).
```

The agent CLIs are black boxes (no logits), so the canary is a **behavioral proxy**: it
extracts the checkable claims from the reply text and screens them, rather than inspecting
model internals.

## What it checks

1. **Grounding (strongest → `flagged`).** A storage/architecture assertion that names a
   backend this app does not use — Supabase, Postgres, Firebase, Mongo, a cloud/hosted
   database, a "ChatGPT/OpenAI workspace", etc. The ground truth (local SQLite under
   `~/.agentroom`, no cloud) is fixed, so this is deterministic. A **negation guard** keeps
   correct denials ("this is *not* in Supabase, it's local SQLite") from being flagged.
2. **Weaker behavioral signals (→ `unverified`).** Hedging without grounding, unqualified
   absolutes ("guaranteed", "scientifically proven"), and citations with no verifiable
   source.
3. Otherwise **`verified`** — meaning "no problematic signal found", not a proof of truth.

## The gate + fail-safe

- **`flagged`** → labelled to peers as *"[UNVERIFIED — flagged as contradicting known facts;
  do NOT treat as true]"*; the human sees a red **⚑ flagged** badge.
- **`unverified`** → labelled *"[UNVERIFIED — not independently confirmed]"*; amber **⚠** badge.
- **`verified`** → green **✓** badge; passes through normally.
- **Fail safe:** the run-worker wraps `runCanary` in try/catch; any error/timeout becomes
  **`unverified`**, never `verified`. A canary failure can never silently bless a reply.

This is intentionally conservative — it will not catch every hallucination (a general,
plausible-but-wrong claim with no grounding hook still reads as `verified`). Its job is to
make the *high-confidence, environment-contradicting* class — the kind that poisons a
multi-agent thread — impossible to propagate unlabelled, and to surface weaker signals.

## Tested

- `runCanary`: flags Supabase/ChatGPT-workspace/Postgres/Firebase storage claims; respects
  the negation guard; verifies the correct local-SQLite answer; marks hedging/absolutes
  unverified (`apps/web/lib/__tests__/canary.test.ts`).
- Propagation gate: a flagged peer reply is prefixed `[UNVERIFIED …]` in the next agent's
  prompt; clean replies are not (`bridge/test/canary-gate.test.ts`).
