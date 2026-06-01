---
description: Record an out-of-band context note ("by the way ...") and act on it now
argument-hint: <a fact, constraint, or correction>
allowed-tools: Read, Write, Edit, Bash
---

# /btw — by the way (context note)

I'm handing you an important out-of-band fact, constraint, or correction:
`$ARGUMENTS`

Do this, then resume what you were doing:

1. **Acknowledge** in one line and restate what changes as a result.
2. **Persist it** so it survives the session: append a bullet under an
   `## Environment & context notes` section in
   `docs/production-hardening/PROGRESS.md` (create the section if missing). Never
   write secrets — redact values.
3. **Apply it immediately.** If it contradicts something you're mid-way through,
   stop that action and adjust your plan.
4. **If it reveals a blocker** (e.g. a missing tool), pick the documented fallback
   and continue without asking — unless the choice is irreversible or expensive, in
   which case ask me ONE precise question.

Keep it short. Don't re-plan the whole project over one note.
