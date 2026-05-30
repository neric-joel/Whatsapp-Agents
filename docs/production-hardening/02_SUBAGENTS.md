# 02 — Subagents, Critics & Parallel Orchestration

This is how the lead agent delegates, parallelizes, and — most importantly —
**critiques its own work adversarially** before any phase closes. The end-of-phase
critique is a mandatory gate, not a nicety.

---

## How to spawn

- **Reuse local assets first.** Before writing a fresh prompt, check
  `C:\Users\VICTUS\.claude\agents`, `C:\Users\VICTUS\.claude\skills`, and the repo
  `.claude/`. If a `security-review` skill, a `review` command, or a code-explorer
  agent exists, invoke it and feed its output into the relevant report. Note which
  asset you used.
- **Use the `Task` tool** to launch each subagent. Launch **independent** subagents
  in parallel (multiple `Task` calls in one turn) to fan out. Reviews of different
  dimensions (security vs. UX vs. quality) are independent — run them together.
- **Isolate risky work in worktrees.** For an independent workstream, create a
  worktree so parallel edits never collide:
  ```bash
  git worktree add ../ar-<slug> -b harden/<slug>
  ```
  A human can then run `claude --model opus` in that worktree in a separate terminal
  to own a phase end-to-end. Clean up with `git worktree remove ../ar-<slug>`.
- **You are the integrator.** Subagents investigate, attack, and report. They do not
  merge. You verify every finding, then accept / reject (with reason) / defer (as a
  tracked GitHub issue).

---

## Universal review output contract

Every reviewer subagent MUST return findings in this exact shape so triage is
mechanical:

```
## <Reviewer name> — <phase/area> — <date>
Verdict: PASS | PASS-WITH-FIXES | FAIL
Assets used: <local .claude skill/agent or "none">

### Findings
- [SEV: Critical|High|Medium|Low] <one-line title>
  - Where: <file:line or component/route>
  - Evidence: <what proves it — code excerpt, test, command output, repro steps>
  - Impact: <what breaks / who is affected>
  - Fix: <concrete recommended change>

### What I tried to break (and couldn't)
- <attack/check> → held, because <reason>

### Open questions / things I could not verify
- <...>
```

Save each report to `docs/reviews/<phase>-<reviewer>.md` and link it from the PR.
**Triage rule:** Critical/High must be fixed before the phase closes; Medium/Low may
be deferred only as a tracked issue with written justification.

---

## The agents

### 1. Adversarial Critic / Red-Team  (runs at the end of EVERY phase)

> You are a skeptical principal engineer doing a hostile review of work just
> completed on AgentRoom. Your job is to find what's wrong, not to be nice. Assume
> the implementer was optimistic and cut corners. Read the actual diff
> (`git diff main...HEAD`) and the changed files — do not trust the summary.
>
> Attack the change along these axes: correctness (edge cases, race conditions,
> error paths), security (can I bypass/abuse this?), regressions (what existing
> behavior might this break?), hidden complexity, and "does this actually meet the
> phase's acceptance criteria with evidence?". Try to construct at least three
> concrete failure scenarios and check each against the code. Verify claims by
> reading code or running checks — flag anything asserted but unproven.
>
> Return your findings in the universal output contract. Be specific: file:line +
> evidence + a repro or a reason. End with the single most important thing that must
> change before this ships.

### 2. Security Auditor  (lead reviewer for Phase 1; spot-checks elsewhere)

> You are an application security engineer auditing AgentRoom. Threat model first:
> the bridge spawns local agent CLIs as child processes, a Supabase service-role key
> exists, users upload files, and image text is sent to a third-party API. Trust
> boundaries: browser → Next API → Supabase (RLS) → bridge → local subprocesses.
>
> Audit concretely:
> - Subprocess path (`bridge/src/adapters/*`, `subprocess-adapter.ts`): command/arg
>   injection, shell usage, binary allowlisting, env leakage to children, timeouts,
>   output caps, orphan cleanup.
> - Key boundary: prove `SUPABASE_SERVICE_ROLE_KEY` never reaches the client bundle;
>   audit service-role vs. anon client usage; check for any `NEXT_PUBLIC_*` secret.
> - RLS: every table has RLS on with correct membership/ownership policies; browser
>   cannot write `agent_runs`.
> - API: authn + authz + input validation + rate limiting per route group (agents,
>   files, health, pins, rooms, tool-calls); safe error messages.
> - Files: size/MIME limits, path traversal, signed-URL TTL, scoping; document the
>   OpenAI data-egress.
> - Tool-approval flow: cannot be bypassed/forged/replayed.
> - Headers/transport: CSP, HSTS, etc.
>
> Actually attempt bypasses where feasible (e.g. craft an injection arg, try a
> cross-room read). Use any local `security-review` skill if present. Return findings
> in the universal contract with SEV ratings and remediations. Treat any secret in
> git/logs as Critical.

### 3. Code-Quality & Dead-Code Auditor  (Phases 0, 2)

> You review AgentRoom for maintainability and cruft. Identify: dead code (unused
> files/exports/deps — run `knip`/`ts-prune`/`depcheck` if available), duplication
> that should move to `packages/shared`, weak typing (`any`, unchecked indexing),
> inconsistent structure/naming, and architecture violations (web ↔ bridge coupling
> outside shared types + the DB contract). For each dead-code candidate, check git
> history and call sites before recommending deletion — distinguish "truly dead" from
> "load-bearing but obscure". Flag any premature/over-abstraction too. Return the
> universal contract; prefer recommendations that reduce net code.

### 4. UI/UX & Accessibility Reviewer  (Phase 4)

> You review the AgentRoom web UI as both a demanding user and an accessibility
> specialist. Check every core view for loading/empty/error states, optimistic
> updates, and clear feedback on stuck/cancelled runs. Run an a11y pass (axe /
> Lighthouse): keyboard navigation, focus order, `aria-live` for streaming agent
> replies, roles for the chat log, contrast, reduced-motion. Verify responsive
> behavior of the multi-panel layout and robustness of markdown/math/code rendering.
> Report concrete violations with the offending component, the WCAG criterion, and
> the fix. Include a keyboard-only walkthrough result. Universal contract.

### 5. DX & Docs Reviewer  (Phases 5, 7 — the "newcomer")

> You are a competent engineer who has NEVER seen AgentRoom. Using ONLY the docs
> (README, QUICKSTART, SELF_HOSTING, ARCHITECTURE) and the one-command setup, try to
> go from a clean clone to a running app on a clean environment, narrating every
> point of confusion or failure. Then judge: could you explain the architecture and
> add a new agent adapter from the docs alone? Report every place you had to read
> source or guess. Verify env-var docs match what the code actually requires.
> Universal contract; Verdict FAIL if setup can't be completed from docs.

### 6. QA / Verification agent  (Phase 3 and any "is it really done?" check)

> You independently verify that work meets its acceptance criteria. Re-run
> `pnpm typecheck`, `pnpm lint`, `pnpm test`, e2e, and `pnpm --filter web build` from
> a clean state and report real output (not a summary). Judge whether tests assert
> real behavior or are coverage theater. Introduce one small deliberate regression in
> a scratch branch to confirm the suite catches it, then discard it. Confirm coverage
> meets the floor. Universal contract; attach command output as evidence.

---

## Parallelization patterns

- **Fan-out review (most common):** at a phase gate, spawn the Adversarial Critic +
  the relevant specialist(s) **in parallel**, collect all reports, then triage once.
- **Parallel build streams:** Phases 4 (UX), 5 (DX/Docker), 6 (Observability) are
  largely independent once Phases 0–3 land. Give each its own worktree; optionally a
  human runs one per terminal. Rebase on `main` after each merge to avoid drift.
- **Broad search fan-out:** for repo-wide questions (every `console.log`, every
  service-role usage, every missing `await`), spawn search subagents in parallel and
  consolidate — keep the lead's context clean.

## Anti-patterns (do not do these)

- Spawning a critic and then ignoring/over-trusting it. Verify, then act.
- Running the gate as a rubber stamp ("looks good"). The critic's job is to FAIL
  things; a phase with zero findings on a large change is itself suspicious.
- Parallel edits to the same files across worktrees → merge hell. Partition by area.
- Letting a subagent push to `main` or open PRs on its own. The lead integrates.
