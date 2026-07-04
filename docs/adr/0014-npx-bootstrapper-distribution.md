# 0014 — Distribution: `npx agentroom` as a tiny source bootstrapper

- **Status:** Accepted
- **Date:** 2026-07-03

## Context

Until now nothing was installable: every package was `private: true` and
`release.yml` produced only a GitHub Release, so users had to `git clone`. A public
launch needs a real, provenance-signed published artifact. Three constraints shape
the design (all verified in-repo):

1. The workspace packages ship **raw TypeScript** (`main: ./src/index.ts`; the
   bridge runs under `tsx`) — there is no dist output to publish.
2. Next.js **output file tracing is disabled** (a deliberate Windows `@vercel/nft`
   EPERM workaround, CHANGELOG v1.3.0), so `output: 'standalone'` is unavailable
   and a built `.next` is not relocatable without the full workspace
   `node_modules`.
3. `scripts/launch.mjs` is already the tested end-user entry point: install if
   needed → build → run web + bridge → readiness probe → open browser → teardown.

## Decision

Publish **one tiny npm package, `agentroom`** (the root manifest), containing only
`scripts/npx-bootstrap.mjs` (+ README/LICENSE). Its bin:

1. downloads the GitHub **source tarball for its own exact version tag**
   (`archive/refs/tags/v<version>.tar.gz`) into `~/.agentroom/app/<version>/`
   (cached; `AGENTROOM_SOURCE_TARBALL` overrides the source for pre-tag testing),
2. extracts it with the system `tar` (ships with Windows 10+, macOS, Linux),
3. ensures Node ≥ 22.13 and `pnpm` (offering `corepack` when missing), and
4. hands over to the repo's own `scripts/launch.mjs`.

`release.yml` gains a `publish-npm` job: it runs only on the human-pushed semver
tag, after a green `verify`, publishes with **npm provenance** (OIDC
`id-token: write` + `npm publish --provenance`), verifies the tag matches
`package.json` version, and **skips with a visible notice when `NPM_TOKEN` is
absent** so the GitHub Release is never blocked by a missing secret.

Versioning stays **manual lockstep**: the root `package.json` version is bumped in
the release PR and must equal the pushed tag (CI enforces it). We deliberately do
**not** adopt Changesets: only this one meta-package is published, its version *is*
the release tag, and the repo already has a working Keep-a-Changelog discipline —
a versioning framework would add machinery without a consumer.

## Consequences

- `npx agentroom` becomes the entire quickstart — no git required. The artifact is
  a few KB, auditable in one sitting, and published with provenance once the
  OIDC publish job actually runs.
- First run does honest, visible work (download + install + build, a few minutes),
  the same work the git quickstart always did. The bin says so up front.
- CI refuses to publish a tag/version mismatch, so the published bin always targets
  the tag it was cut from. **The tag's content is the trust root**, not the npm
  artifact: npm provenance attests only the 4-file bootstrapper, and a force-moved
  tag would change what users build and run. Release prerequisite: a GitHub
  **ruleset protecting `v*` tags** (block update/delete), so tags are immutable
  once released.
- The libraries (`@agentroom/shared`, `@agentroom/db`) stay private — publishing
  them would require inventing a build/exports layer for consumers who don't exist
  yet (revisit on demand).
- Requires network + system `tar` on first run; download, missing-`tar`, and
  extraction failures each print the git-quickstart fallback. Extraction happens in
  a scratch dir on the destination filesystem (renames can't cross devices — `/tmp`
  is a separate tmpfs on much of Linux), and Windows uses the bundled System32
  bsdtar (Git Bash's GNU tar mis-parses drive-letter paths).
- The bin attempts `corepack enable` automatically when pnpm is missing (corepack is
  bundled with Node 16–24); on newer Node the attempt fails quietly and the manual
  instructions print instead.
- Post-first-publish hardening (owner): use a granular npm automation token scoped
  to `agentroom` (or switch to npm Trusted Publishing/OIDC and delete the token),
  and enable 2FA — a long-lived classic token could publish provenance-less
  versions from anywhere.

## Alternatives considered

- **Bundle the prebuilt app into the tarball** — rejected: constraints 1–2 make the
  tarball enormous, platform-entangled, and fragile (native `better-sqlite3`,
  non-relocatable `.next`).
- **Publish the workspace libraries** (Changesets, tsc builds) — rejected for
  launch: high machinery cost, no user demand; the user need is "run the app".
- **GitHub release assets only** — rejected as primary: not a registry artifact,
  no provenance, no `npx` path.
