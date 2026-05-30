# AgentRoom hardening runner

Restart-safe automation that drives the production-hardening loop to completion,
surviving usage-limit windows, crashes, and reboots. State lives in `PROGRESS.md`
(not session memory), so any fresh launch resumes from the active `/goal`.

## Pieces
- **`scripts/agent-runner.ps1`** — loops headless Claude Code
  (`claude --model opus --continue -p <resume prompt> --dangerously-skip-permissions`),
  teeing output to `docs/production-hardening/runner.log`. On a detected usage/rate
  limit it sleeps ~5h; otherwise it backs off 30s and continues. It exits only when
  `docs/production-hardening/DONE.flag` exists.
- **Scheduled Task `AgentRoomHarden`** — launches the runner at logon and every 5h.
  `MultipleInstancesPolicy=IgnoreNew` makes the 5h trigger a crash/limit safety net:
  it starts a new run only if one isn't already active.
- **`.claude/settings.json`** — committed permission allow-list (pnpm/git/gh/node/… +
  Edit/Write/Task/WebSearch/WebFetch). The runner additionally passes
  `--dangerously-skip-permissions` because unattended operation cannot pause for a
  prompt; `main` stays protected by branch/PR discipline and secrets are never committed.

## Start
```powershell
schtasks /Run /TN AgentRoomHarden          # via the scheduled task (auto-starts at logon)
# or run in the foreground in the current terminal:
powershell -ExecutionPolicy Bypass -File scripts\agent-runner.ps1
```

## Stop
```powershell
New-Item docs/production-hardening/DONE.flag -ItemType File   # graceful: finishes the cycle, then exits
schtasks /End /TN AgentRoomHarden                              # stop a running instance now
schtasks /Change /TN AgentRoomHarden /DISABLE                 # stop auto-relaunch
schtasks /Delete /TN AgentRoomHarden /F                       # remove entirely
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\agentroom-harden.cmd"  # remove logon launcher
```
`DONE.flag` and `runner.log` are gitignored (local control only). To fully stop
auto-resume you must BOTH stop/disable the task AND remove the Startup-folder launcher.

## Verify resume (dry run)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\agent-runner.ps1 -DryRun
```
Prints the active goal parsed from `PROGRESS.md`, tool availability, and the
`DONE.flag` state — without launching Claude.

## Notes
- If `gh` reports "not logged into any GitHub hosts", run `gh auth login` once. The
  runner refreshes PATH on each start, so a freshly-installed/authed `gh` is picked up.
  Until then, PRs are pushed as branches with paste-ready bodies (`GITHUB_ISSUES.md`).
- Secret hygiene: the runner pipes Claude output through `RedactSecrets` (mirrors
  `bridge/src/lib/redact.ts`) before writing `runner.log`, and the log is gitignored.
  Still treat `runner.log` as sensitive local plaintext.
- `main` protection: enforced by GitHub branch protection (server-side) AND a local
  `.githooks/pre-push` hook — both hold even under `--dangerously-skip-permissions`.
  Enable the hook once per clone: `git config core.hooksPath .githooks`. The runner
  opens PRs; it must never merge them (humans review + merge).
- Logs: `docs/production-hardening/runner.log`. Living status: `PROGRESS.md`.
