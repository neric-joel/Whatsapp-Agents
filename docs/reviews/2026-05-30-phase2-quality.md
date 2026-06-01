# Phase 2 Quality — Critique Gate

- **Date:** 2026-05-30
- **Branch:** `harden/p2-quality` (stacked on `feat/p1-security`)
- **Reviewers:** Code-Quality Reviewer + Architecture Reviewer (`.claude` subagents)
- **Verdict:** **PASS** — no open Critical/High from either reviewer.

## Verification evidence (independently re-run)
- `pnpm -r typecheck` — green (shared, bridge, web) with `noUncheckedIndexedAccess`
- `pnpm lint` (`eslint .`) — **0 errors**, 27 warnings (style/perf hints; bug-catchers stay errors)
- `pnpm format:check` — clean (Prettier enforced repo-wide)
- `pnpm exec knip` — exit 0 (all 4 workspaces analyzed: agentroom, web, bridge, @agentroom/shared — verified via `knip --debug`)
- `pnpm -r test` — **135 passing** (59 bridge + 76 web)
- `pnpm --filter web build` — Compiled successfully

## Reviewed (both: sound)
- **TS tightening:** shared `tsconfig.base.json` hoists strictness only; each workspace keeps its own module/resolution. The 6 `noUncheckedIndexedAccess` fixes are behavior-preserving (regex groups `?? ''` never trigger when the overall match succeeds; `rooms[0]` guard identical truthiness). `noFallthroughCasesInSwitch` passing confirms no latent fallthrough.
- **ESLint config is real, not fake-green:** `react-hooks/rules-of-hooks`, `no-undef`, full typescript-eslint/js recommended stay at error; only style/perf rules are warn.
- **Dead-code removal safe:** `err()` and `requireRoomAdmin()` had zero referencers (incl. dynamic/string usage); ~23 internal-only symbols de-exported (no barrel/re-export broken). The "shared/index.ts de-exports" were Prettier-only — shared public API unchanged.
- **`ignoreDuringBuilds`** is legitimate lint/build decoupling (lint is its own CI job).

## Findings and disposition
| ID | Sev | Finding | Disposition |
|----|-----|---------|-------------|
| Q-1 | Low | Hardcoded absolute Windows path in ESLint `no-html-link-for-pages` → breaks on CI/Linux | **Fixed** — derived from `import.meta.dirname` |
| A-1 | Med | `AgentProvider` duplicated in `provider-styles.ts` vs `@agentroom/shared` | **Fixed** — imports from shared |
| A-2 | Low | `packages/shared/tsconfig.json` vestigial `declaration`/`outDir` under inherited `noEmit` | **Fixed** — removed (source-only package) |
| A-3 | Med | Web *test* files import `bridge/src/{denylist,redact}` directly (pre-existing, test-only) | **Deferred** → For morning review: promote denylist/redact to `packages/shared` (or move tests to bridge) + add a `no-restricted-imports` web↔bridge boundary rule |
| A-4 | Low | `ParsedMention` type duplicated (web vs bridge); the functions intentionally diverge | **Deferred** — share the type only later |
| A-5 | Low | type-aware lint disabled (`projectService:false`) — no `no-floating-promises` | **Accepted** — pragmatic; revisit on bridge later |

No Critical/High. Phase 2 acceptance criteria met with linked evidence.
