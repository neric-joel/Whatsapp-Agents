# 0008 — MIT license

- **Status:** Proposed
- **Date:** 2026-05-31

## Context

The project is being prepared for open-source release and had no `LICENSE`. A license
is required for others to legally use, modify, and self-host the code. The choice is
ultimately the repository owner's.

## Decision

Adopt the **MIT license** as the safe, permissive default for a self-hostable template
project: minimal restrictions, maximum adoption, well understood. `package.json` is set
to `"license": "MIT"` to match.

## Consequences

- Anyone may use, modify, and redistribute the code with attribution and no warranty.
- Permissive licensing maximizes adoption and contribution; it does not require
  derivative works to stay open.
- **Owner gate:** this is marked *Proposed* — the owner can change the license (e.g. to
  Apache-2.0 for an explicit patent grant, or a copyleft license) before the v1.0
  release; update `LICENSE`, this ADR, and `package.json` together if so.

## Alternatives considered

- **Apache-2.0** — adds an explicit patent grant + NOTICE handling; heavier but
  enterprise-friendly. A reasonable alternative if patent protection is desired.
- **AGPL/GPL** — copyleft; rejected as the default for a template meant to be embedded
  and self-hosted freely.
