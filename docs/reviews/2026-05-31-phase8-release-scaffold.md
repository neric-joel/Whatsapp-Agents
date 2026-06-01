# Phase 8 (automatable scaffold) — release workflow — critique gate

Date: 2026-05-31 · Branch: `harden/p8-release-scaffold`

**Reviewer:** CI/CD security red-teamer (`general-purpose`) on `.github/workflows/release.yml`.
**Verdict: PASS** — no Critical/High. Verified against the real workflow + the existing
`ci.yml`/`docker.yml`/`package.json`.

## Triage

| SEV | Finding | Disposition |
|-----|---------|-------------|
| Low | Tag glob `v*.*.*` admits non-semver / pre-release tags (cannot auto-tag, so the human gate holds, but `v1.2.foo` would trigger a real Release) | **FIXED** — added a strict semver guard step (`^v[0-9]+\.[0-9]+\.[0-9]+(-…)?$`) that fails the `release` job on a malformed tag. |
| Low | `verify`/`images` jobs inherited `contents: write` (harmless over-grant) | **FIXED** — top-level `permissions: contents: read`; only the `release` job escalates to `contents: write`. |
| Low | `images` job has no `cache-to` → release image builds run cold | **Accepted** — intentional (don't pollute the branch cache from tag builds); correctness unaffected. |
| Info | Release builds prove images **compile** but don't smoke-test boot (docker.yml does that on `main` before the tag) | **Accepted** — the on-`main` smoke test already gates this; documented. |

## Verified safe (reviewer)

- **Trigger:** fires only on `push` of a `v*.*.*` tag — no `workflow_dispatch`, no branch
  trigger, no auto-tagging step. `cancel-in-progress: false` is correct for a release.
- **Permissions/secrets:** only `github.token`; no external secrets; dummy build-args
  match `ci.yml`/`docker.yml`; no secret in logs or build-args.
- **Correctness:** `gh release create --generate-notes --verify-tag` valid; `fetch-depth: 0`
  enables diffed notes; gate steps match `package.json` + `ci.yml`; image builds match
  `docker.yml` (web gets the 3 `NEXT_PUBLIC_*` args, bridge none, both `push: false`).
- **No partial publish:** `release` `needs: [verify, images]`, so a failed gate or image
  build blocks the Release.

Post-fix: YAML valid, `pnpm format:check` ✓. 0 open Critical/High.

## Scope note

This closes the **automatable** parts of Phase 8 (CHANGELOG — created in Phase 7 — +
the release workflow). The **`v1.0.0` tag, the release publish, and the final
DoD-complete sign-off remain human-gated** and are intentionally NOT done here (per the
overnight DEFER policy). The workflow is inert until a maintainer pushes a semver tag.
