# Architecture Decision Records

Short, immutable records of significant architectural decisions: the context, the
decision, and its consequences. New decisions get a new numbered file; superseded ones
are marked, not deleted. Format is [MADR](https://adr.github.io/madr/)-lite — see
[`0000-template.md`](0000-template.md).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-locked-stack.md) | Locked stack: Next.js + Supabase + bridge daemon + pnpm monorepo | Accepted |
| [0002](0002-agent-runs-as-queue.md) | `agent_runs` table is the work queue (no Redis) | Accepted |
| [0003](0003-separate-bridge-daemon.md) | A separate bridge daemon runs agent CLIs | Accepted |
| [0004](0004-local-supabase-default.md) | Local Supabase via Docker is the default (no paid plan) | Accepted |
| [0005](0005-subprocess-sandbox.md) | Subprocess sandbox for agent CLIs | Accepted |
| [0006](0006-opt-in-third-party-egress.md) | Third-party image egress is opt-in, off by default | Accepted |
| [0007](0007-observability-surfaces.md) | Observability: structured logs, health/metrics endpoints, opt-in error tracking | Accepted |
| [0008](0008-mit-license.md) | MIT license | Proposed |
