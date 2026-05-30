# Adversarial Critic — Phase 0 — 2026-05-30

Verdict: PASS-WITH-FIXES
Assets used: code-reviewer agent (local ~/.claude)

Reviewed `git diff main...HEAD` (5 commits, 68 files) and **re-ran the full CI pipeline locally** with ci.yml's dummy env: `pnpm install --frozen-lockfile`=0, typecheck=0, lint=0, test=14/14, `--filter web build`=0 (17 routes). Local pnpm 11.0.8 matches the pin; lockfile byte-identical to main (no frozen-install drift).

## Findings
- **[High] `--dangerously-skip-permissions` nullifies the settings.json deny-list; nothing actually protects `main`.**
  - Where: `scripts/agent-runner.ps1` (claude invocation) + `.claude/settings.json` deny rules.
  - Evidence: the flag bypasses the permission layer entirely; also `branch.main.merge=refs/heads/main` is configured, so a bare `git push` while on main matches none of the deny patterns. Only prose ("branch/PR discipline") protects main.
  - Fix: GitHub branch protection on main (server-side, survives the flag) + a pre-push hook. → **RESOLVED** (branch protection enabled + `.githooks/pre-push` committed + `core.hooksPath` set).
- **[Medium] Unattended runner can print secrets into `runner.log`** (Claude could `cat .env`). Log is gitignored, but plaintext on disk + read back for limit-detection. → **RESOLVED** (`RedactSecrets` filter on the tee).
- **[Low] Singleton mutex is `Local\` (session-scoped), not machine-wide.** Covers the realistic logon/5h/manual cases via Local\ + IgnoreNew; two interactive logons could double-launch. → comment softened; accepted for a solo box.
- **[Low] Acceptance not fully met until PR pushed + CI observed green** and the High resolved. → addressed by pushing the branch, opening the PR, and watching CI.
- **[Info] `supabase/config.toml` change is a correct fix** (old `project_id` parsed under `[analytics]`; `[functions]` block inert — no edge functions). **[Info]** the `<img>` lint warning is non-blocking and pre-exists (→ Phase 4).

## What I tried to break (and couldn't)
frozen-lockfile drift (none); CI red on dummy build (built fine); deleting lib/api.ts breaking an importer (only `.worktrees/` copies referenced it); health contract mismatch (apiSuccess emits the documented envelope); CI YAML/action validity (valid; action order correct); runner not stopping on DONE.flag (stops correctly).

## Single most important thing
Enable GitHub branch protection on `main` — the one control that survives `--dangerously-skip-permissions`. **(Done in this iteration.)**
