# LinkedIn launch post

## Primary draft

I built a chat room where the AI coding CLIs you already have installed talk to each other — and then I spent most of the project teaching it not to trust them.

**AgentRoom** runs on localhost. Claude Code and Codex join as named participants in one thread. You type a message; each replies as itself. They can @mention each other. Type `/discuss` and they work the problem as a team — a coordinator splits it into sub-tasks, they build on each other's work on a shared blackboard, and the final answer says who contributed what.

No accounts. No API keys pasted anywhere. It runs the binaries you already have, and they authenticate exactly the way they do in your terminal. State is a SQLite file under `~/.agentroom`. The server binds 127.0.0.1 and makes no network calls of its own.

Three things I learned building it:

**1. In a room, one agent's hallucination becomes the next agent's premise.**

I asked a fresh room where its own data was stored. One CLI said Supabase Postgres. Another invented a "ChatGPT workspace service." The real answer is a local SQLite file — and neither agent had any way to know, because they're black-box CLIs that wake up with no idea what they're running inside.

In a single-agent chat that's a wrong answer. In a room it's contagious. So every reply is screened before it's committed, and a flagged reply arrives in every other agent's context wearing an `[UNVERIFIED]` label telling them not to treat it as true. A claim can still be wrong. What it can't do is quietly become the room's consensus.

**2. Agent teams rubber-stamp each other, and you have to force the fight.**

Agreement is the statistically easy token. My first `/discuss` looked collaborative and provably wasn't — the context window was capped at the triggering message, so agents literally could not see each other's drafts. Three agents typed past each other while a coordinator stapled the output together.

Now there's a dissent stage: after integration, if nobody has substantively challenged anything, an extra round runs with the instruction "name the single weakest point in the current solution and propose a concrete fix. Do not rubber-stamp." If there's *still* no pushback, the result gets stamped `no_challenge_after_dissent` in the thread metadata — so you at least know the team never really disagreed.

**3. The feature I'm most proud of is a deletion.**

Before launch I ran an honesty pass with one rule: every advertised feature must be reachable by a real user, or the claim goes. Three claims failed and got removed. One of them led me to discover that the room's agent panel had never worked once — it read `member.agents`, the API returns `member.agent`, so the filter silently dropped every row and the panel said "No agents in this room yet" while agents chatted away next to it.

That bug has a sequel. Preparing this launch, I ran a multi-agent adversarial review over my own codebase — parallel reviewers by lens (security, concurrency, platform, data), each finding independently cross-examined by skeptics instructed to *refute* it. It found that exact singular/plural bug had silently come back, plus 11 others including a stored-XSS path and four Windows-only subprocess failures. Every one of them was real. My own tests were green the whole time.

The uncomfortable lesson: green tests told me the shape of things was right. They said nothing about whether the thing worked.

`npx agentroom` if you want to try it. It's MIT, single-user by design, and the docs are explicit about what's wired versus what's dormant scaffolding — including that connected CLIs run with your real permissions, because there's no OS sandbox and I didn't want the README implying one.

Repo: https://github.com/neric-joel/Whatsapp-Agents

---

## Notes for posting

- **Length:** ~430 words. LinkedIn truncates around 210 characters, so the first two lines carry the click. The hook is the "taught it not to trust them" turn.
- **Hashtags** (put them at the end, not inline): `#AI #DeveloperTools #OpenSource #SoftwareEngineering #LLM`
- **Media:** lead with `docs/demo/agentroom-demo.gif` — the `/discuss` run with attribution badges is the single most legible artifact. Video/GIF outperforms a link preview.
- **First comment:** drop the repo link there as well; LinkedIn suppresses reach on posts with outbound links in the body.
- **What was deliberately left out:** the canary's HalluCana lineage, the memory injection-scanning design, and the ADR trail. They're the strongest material for a *technical* audience — save them for a follow-up post or point people at `docs/WRITEUP.md`.
- **Honesty check:** every claim here is verifiable in the repo. The 12-bug figure is the count of adversarially-confirmed findings from the pre-launch sweep, all fixed before this post. Don't inflate it.
