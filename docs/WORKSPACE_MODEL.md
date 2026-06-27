# Workspace model — Cowork concepts mapped to AgentRoom

AgentRoom v2 borrows the workspace shape of [Claude Cowork](https://www.anthropic.com/product/claude-cowork):
you start by choosing a **working folder**, work is scoped to it, the workspace is
**named and persistent**, and there's room for **memory** and **outputs**. This doc maps
those concepts to AgentRoom and records the local-app design decisions.

## What Cowork does (researched)

- A Cowork **Project** is a persistent, self-contained workspace with its own files,
  instructions, memory, and scheduled tasks. You build one from scratch, import a project,
  or **use an existing folder on your computer**. ([support.claude.com](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork), [vpncentral](https://vpncentral.com/anthropic-adds-projects-to-claude-cowork-desktop-to-keep-files-instructions-and-memory-in-one-workspace/))
- Claude reads from folders you grant, **writes outputs back** to them, and deletes only
  after an approval prompt. Deliverables land in the file system at a designated location.
- **Memory** persists within a project across its sessions (not across standalone sessions).
- **Agent teams**: one lead coordinates; teammates work in their own context and load the
  project context (CLAUDE.md, MCP, skills) but not the lead's conversation history. ([code.claude.com](https://code.claude.com/docs/en/agent-teams))

## Mapping to AgentRoom

| Cowork | AgentRoom |
|---|---|
| Project / workspace | **Session** — a named working context bound to a folder |
| "Choose a folder to work in" | `sessions.working_dir` (an absolute path on this machine) |
| Project name | `sessions.name` (auto-named from the folder + date; renamable) |
| Persistent project | Sessions live in local SQLite and resume after restart |
| Outputs delivered to the file system | The session's `working_dir` is where attachments/outputs live (outputs panel, Phase D) |
| Project memory | Session-scoped memory (Phase E) |
| Agent team in a project | A **room** inside a session; the user picks which agents join (Phase C) |

A **session has many rooms**; a room belongs to one session (`rooms.session_id`). The
working folder is the session's anchor — the place the agents' work is about and where
produced files belong.

## Decisions (local, single-user)

- **D-W1 — Folder is a server-side path, not a browser handle.** A browser can't hand the
  server an arbitrary filesystem path (and the File System Access API only yields an opaque
  handle). Since AgentRoom is local and the bridge runs CLIs on this machine, the working
  folder is an **absolute path the user enters**, validated server-side. This mirrors Cowork's
  "use an existing folder on your computer". Validation (issue #67) requires the folder to
  exist, be a real directory, and — after resolving symlinks — live **inside an allow-root**
  that defaults to your **home directory** (it also rejects UNC/device paths, traversal, and
  credential dirs like `~/.ssh` / the app's own `~/.agentroom`). To open a folder outside your
  home (e.g. projects on another drive), set the env var **`AGENTROOM_WORKSPACE_ROOT`** to an
  absolute path before starting; working folders must then live under it.
- **D-W2 — Auto-name then rename.** New sessions are named `<folder basename> · <date>`;
  the user can rename anytime. No blank-name sessions.
- **D-W3 — Active session = most recently active.** `sessions.last_active_at` tracks the
  current session; switching updates it. New rooms attach to the active session.
- **D-W4 — Backward compatible.** Rooms created before sessions have `session_id = NULL`
  and are grouped under the active session's view as "unassigned" rather than orphaned.
- **D-W5 — Read-only-for-now folder.** v2 persists + displays the working folder and uses
  it as the outputs root; wiring it as each CLI's spawn `cwd` is a tracked follow-up (the
  subprocess layer would need a per-run cwd, kept out of this phase to avoid touching the
  hardened spawn path under time pressure).

## Onboarding flow

1. First launch (no sessions) → **"Start a session"**: enter a working folder + optional name.
2. Inside a session → **New room**: name it and **pick the agents** from the connected-CLI
   catalog (Phase C). Only connected CLIs are offered.
3. Everything persists; reopening the app lists sessions to resume.
