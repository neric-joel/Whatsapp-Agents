# Phase 7 — Documentation & open-source readiness — critique gate

Date: 2026-05-31 · Branch: `harden/p7-docs-oss`

**Reviewer:** DX & Docs Reviewer with a skeptical **newcomer persona** (`general-purpose`),
cross-checking every doc claim against the real repo (env schemas, `package.json`
scripts, `run-worker.ts`, adapter registry, all markdown links). Per `02_SUBAGENTS.md`.

**Verdict: PASS** — no Critical/High. A fresh contributor can clone, set up, and run
from the docs alone; the architecture is accurately described; **no broken links**;
ADR index complete and consistent; version pins agree across README/CONTRIBUTING/
QUICKSTART.

## Triage

| SEV | Finding | Disposition |
|-----|---------|-------------|
| Med | ARCHITECTURE env table listed `NEXT_PUBLIC_APP_URL` default `http://localhost:3000`, but `env.ts` has `.optional()` with no runtime default | **FIXED** — table now says "— (no runtime fallback); set it outside local dev; Docker sets it as a build arg." |
| Med | "Validated at boot (zod) in both apps" overstated — only the core connection vars are in the zod schema; the rest read from `process.env` with defaults | **FIXED** — reworded in `ARCHITECTURE.md` + `CONTRIBUTING.md` to "core connection vars validated at boot; the rest have safe in-code defaults." |
| Low | ADR-0008 status `Proposed` contradicted the already-shipped `LICENSE` + `package.json` MIT | **FIXED** — flipped to "Accepted (owner may revisit before v1.0)" in the ADR + index; consequences note kept. |
| Low | `CODE_OF_CONDUCT.md` had no concrete reporting channel | **FIXED** — points to the private GitHub security-advisory form (usable for conduct reports) + the owner's GitHub handle. (No personal email published, by design.) |
| Low | README bridge `.env` block showed `OPENAI_API_KEY`/`OPENAI_VISION_MODEL` without the `ENABLE_IMAGE_TEXT_EXTRACTION` gate | **FIXED** — added the flag (off) with a note + a pointer to the authoritative var list in ARCHITECTURE/`.env.example`. |

## Verified accurate (no defect)

- CONTRIBUTING quality-gate + setup commands all map to real `package.json` scripts;
  `make bootstrap` exists; `knip` resolves and exits 0.
- Write-path / atomic-claim / adapter-registry / mock-only-Docker-image claims match
  the code (`run-worker.ts:86-90`, `registry.ts`, `bridge/Dockerfile`).
- In-code env defaults that the table cites are correct (BRIDGE_* defaults, vision
  model, deprecated-anon-key rejection).
- Every relative markdown link resolves (README↔docs, CONTRIBUTING↔docs/QUICKSTART,
  SECURITY↔docs, ADR cross-links + anchor into OBSERVABILITY, ADR index↔8 ADRs).
- Trust-model / default-adapter / opt-in-egress / license consistency across README,
  ARCHITECTURE, SECURITY, SELF_HOSTING.

Post-fix: `pnpm format:check` ✓, `pnpm typecheck` ✓, `pnpm knip` ✓ (docs-only +
`package.json` license field; no code paths touched). 0 open Critical/High.
