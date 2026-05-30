# Security Auditor — Phase 0 (secret-scan + harness) — 2026-05-30

Verdict: PASS-WITH-FIXES
Assets used: security-auditor agent (local ~/.claude)

## Findings
- **[Critical → resolved/none] Repo-wide secret scan: CLEAN.** Grepped for JWTs (`eyJ…`), `sk-`, `gho_/ghp_/github_pat_`, `service_role`, `BEGIN…PRIVATE KEY`, `AKIA…`, `sbp_/sb_secret_`, long base64/hex outside the lockfile. Only hits: a sha512 integrity hash in `pnpm-lock.yaml` (expected), "ri**sk-**accepted" substring in PROGRESS.md (false positive), and variable-name/doc references. **No committed secret.**
- **[Info] CI dummy env verified fake** (`ci-dummy-*`, `localhost`); `.claude/settings.json` token-free; `scripts/*.ps1` secret-free; `.env`/`.env.local` gitignored + untracked; `.env.example` blank.
- **[High] `main` not enforced under the runner.** `--dangerously-skip-permissions` bypasses settings.json; no `.husky/`, no installed hooks (only `.sample`), no branch protection observed. Only prose protects main. → **RESOLVED**: GitHub branch protection on `main` (enforce_admins, require PR, block force-push/deletion) + committed `.githooks/pre-push` + `core.hooksPath .githooks`.
- **[Medium] Redaction not applied to runner.log / gh bodies.** `bridge/src/lib/redact.ts` is bridge-only. → **RESOLVED** for the log (`RedactSecrets` filter); `gh` body redaction = ongoing discipline (the loop must not paste env/log contents into issues/PRs; noted in RUNNER.md).
- **[Low] Startup-folder launcher removal not documented in RUNNER.md Stop.** → **RESOLVED** (added the `Remove-Item …Startup\agentroom-harden.cmd` step).

## What held up
No committed secret anywhere; CI placeholders unambiguous; `security.yml` ships gitleaks (`fetch-depth: 0`) + audit + CodeQL; runner is otherwise well-built (mutex, DryRun, limit backoff, DONE.flag, IgnoreNew, least-privilege task principal).

## Open questions
Confirm branch protection is active server-side (done this iteration). Has `.env` ever been in history? (gitleaks `fetch-depth:0` on the PR asserts this.) Do any agent prompts print `process.env`? (worth a grep before unattended launch.)
