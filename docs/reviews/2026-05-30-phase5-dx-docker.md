# Phase 5 critique — Developer experience, containerization & onboarding

Date: 2026-05-30 · Branch: `harden/p5-dx-docker-onboarding` · PR: #9
Reviewers (parallel, adversarial): **docker-expert**, **code-reviewer** (scripts + code),
**technical-writer** (docs). All three verdicts: **pass-with-notes**. No Critical, no Fail.

The docker-expert explicitly confirmed the images build + run as designed: Next.js
standalone COPY paths correct for a pnpm monorepo, `CMD ["node","apps/web/server.js"]` +
`HOSTNAME/PORT` correct, bridge `tsx` runtime + `@agentroom/shared` (`--filter bridge...`)
resolve, the `COPY --from=deps /repo ./` preserves the pnpm symlink store, the
`pnpm@11.0.8` corepack fix is version-matched, and no secrets are baked.

## Findings & disposition

| # | Sev | File | Finding | Disposition |
|---|-----|------|---------|-------------|
| 1 | High | `.github/workflows/docker.yml` | `load:false` → CI only proved layers compile, never ran the image (a broken CMD / missing `server.js` would pass green) | **FIXED** — `load:true` + tags; smoke-test steps: web boots & serves `/api/health`, bridge boots & stays up; per-image cache `scope`. This is the verification of record (local `docker build` was disk-blocked). |
| 2 | High | `apps/web/Dockerfile` | builder ran `pnpm install` with no filter (installs bridge too; couples web build to bridge deps) | **FIXED** — `pnpm install --frozen-lockfile --filter web...` (mirrors bridge). |
| 3 | Med (boot-crash) | `docker-compose.yml` | Compose has no variable-valued default; `${SERVER_SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL}}` delivers a literal string → zod URL validation crashes the server at boot when `SERVER_SUPABASE_URL` is unset | **FIXED** — `SERVER_SUPABASE_URL` is now required (`:?`); `.env.docker.example` + `SELF_HOSTING.md` updated (set it = `NEXT_PUBLIC_SUPABASE_URL` for production). |
| 4 | Med | `apps/web/Dockerfile` | no HEALTHCHECK | **FIXED** — image `HEALTHCHECK` probes `/api/health`. |
| 5 | Med | `bridge/src/index.ts` | shutdown comment claimed in-flight runs are "re-claimed" by recovery, but recovery marks them `failed` (not retried) | **FIXED** — comment corrected to be accurate. |
| 6 | Med | `bridge/Dockerfile` | `tsx` is a runtime dep but classified as `devDependency` | **DEFERRED** — functionally correct (install is non-`--prod`); reclassifying churns the lockfile + needs `pnpm install`, risky on the disk-constrained host. Tracked. |
| 7 | Med | `bridge` (no HEALTHCHECK) | port-less worker has no liveness probe | **DEFERRED** — a trivial `node -e exit 0` adds little; real liveness needs a heartbeat-file change. Liveness is observable via `agent_runs.heartbeat_at`; documented in compose. Tracked. |
| 8 | Med | `docs/SELF_HOSTING.md` | self-hosted Supabase compose can clash on 54321/54322 with a local `supabase start` | **FIXED** — added a port-clash caution to Option A. |
| 9 | Low | `.dockerignore` | `*.env.example` not excluded from build context | **FIXED** — added `**/.env.example` + `.env.docker.example`. |
| 10 | Low | `.github/workflows/docker.yml` | shared GHA cache scope could thrash | **FIXED** — `scope=web` / `scope=bridge`. |
| 11 | Low | `scripts/bootstrap.sh` | blank keys from `supabase status` silently proceed | **FIXED** — warns the operator to fill env manually. |
| 12 | Low | `apps/web/Dockerfile` | base image not digest-pinned | **DEFERRED** — needs a digest-rotation process; hardening follow-up. |
| 13 | Low | `scripts/bootstrap.sh` | placeholder-detection brittle to future wording | **NOTED** — current examples use blank placeholders; no action. |
| 14 | Low | docs | OpenAI vision model name / Supabase CLI install note | **NOTED** — accurate as written; no action. |

Scripts/code reviewer separately verified `set -euo pipefail` interactions are sound,
`fill()` never clobbers a real value, the sed in-place edit is BSD/GNU-portable, the
`ANON_KEY`/`PUBLISHABLE_KEY` dual lookup handles both Supabase CLI naming eras, and the
`ServerEnv`/`BridgeEnv` de-export + `axe-core` knip-ignore are correct and non-breaking.

## Result
No open Critical/High after fixes. Local gate green (typecheck/lint/format/knip/test:
web 98 + bridge 66). Image build + run verified in CI (`docker.yml` smoke tests) +
`next build` (`verify`) — see PR #9 checks. Remaining deferrals are tracked above
(non-blocking hardening).
