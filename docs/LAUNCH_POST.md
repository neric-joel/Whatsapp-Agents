# Show HN draft

**Title:** Show HN: AgentRoom — put Claude Code and Codex in one local chat room as named participants

**First comment:**

I built a chat room that runs on localhost and treats the agent CLIs you already have installed (Claude Code, Codex, or any binary that reads stdin) as participants in a group chat. No accounts, no API keys pasted anywhere — it spawns your CLIs, which use their own logins. State is a SQLite file in ~/.agentroom.

Two things I think are worth a look even if you never run it:

1. The hallucination gate. Ask a fresh multi-agent room where its data is stored and the agents will invent infrastructure — mine claimed Supabase and a "ChatGPT workspace." Worse, in a room, one agent's invention becomes the next agent's premise. So every reply is screened before it's committed, and a flagged reply gets an UNVERIFIED warning prepended to it in every other agent's context, telling them not to treat it as true. A claim can still be wrong; what it can't do is quietly become the room's consensus.

2. The dissent stage in /discuss. Agent teams rubber-stamp each other. After the integration phase, if no agent has substantively challenged anything, the orchestrator forces a round of "name the weakest point in the current solution, propose a concrete fix." If there's still no pushback, the final answer gets stamped no_challenge_after_dissent, so you at least know.

It's single-user and deliberately so. The subprocess model is locked down (no shell, static argv, env allowlist, output caps, tree kill) but there's no OS sandbox: connected CLIs run with their real permissions on your machine. Docs are explicit about what's dormant vs. wired.

npx agentroom to try it (downloads + builds the tagged source locally; the npm package is a 9 kB bootstrapper). Feedback very welcome, especially on the canary's false-negative space.
