# 0014 — Distribution: `npx agentroom` as a tiny source bootstrapper

- **Status:** Accepted (amended 2026-07-29 — see "Amendment: the source pin")
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

1. downloads the GitHub **source tarball for the exact commit it was published
   from** (`archive/<commit>.tar.gz`; see the amendment below) into
   `~/.agentroom/app/<version>/` (cached; `AGENTROOM_SOURCE_TARBALL` overrides the
   source for pre-tag testing),
2. extracts it with the system `tar` (ships with Windows 10+, macOS, Linux),
3. ensures Node ≥ 22.13 and `pnpm` (offering `corepack` when missing), and
4. hands over to the repo's own `scripts/launch.mjs`.

`release.yml` gains a `publish-npm` job: it runs only on the human-pushed semver
tag, after a green `verify`, publishes with **npm provenance** (OIDC
`id-token: write` + `npm publish --provenance`), and verifies the tag matches
`package.json` version.

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
  the release it was cut from. npm provenance attests only the 4-file bootstrapper,
  never the source it downloads — so **what the bin downloads is pinned by content,
  not by name** (see the amendment below). The `v*` tag ruleset (block
  update/delete) remains a prerequisite, but the bin no longer depends on it.
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

## Amendment: the source pin, and a publish that fails loudly (2026-07-29)

A security review found two consequences of the original decision that were worse
than the decision assumed.

**A git tag is mutable; the trust root can't be one.** The bin fetched
`archive/refs/tags/v<version>.tar.gz` and verified nothing but the shape of what came
back (`scripts/launch.mjs` exists) before installing, building and executing it.
Force-moving a released tag therefore changed what every future
`npx agentroom@X.Y.Z` compiled and ran, while the npm artifact — the thing provenance
attests and auditors read — stayed byte-identical. The ruleset made that a
*settings* problem rather than a *code* one.

So `publish-npm` now writes an `agentroom.source` block — the released **commit id**
and the **SHA-256 of that commit's GitHub archive** — into the published
`package.json` (never committed; `package.json` ships regardless of `files:`), and
the bin:

- fetches `archive/<commit>.tar.gz` — a commit id cannot be force-moved,
- refuses to extract bytes whose digest does not match the recorded one,
- refuses to run at all when the pin is absent or malformed, and
- constrains the primary fetch's resolved redirect target to `https:` on exactly
  `github.com` or `codeload.github.com` — not a `*.github.com` suffix rule, which would
  also admit `raw`/`objects.githubusercontent.com` (arbitrary user content) on the
  digest-less opt-out path. Previously only the `AGENTROOM_SOURCE_TARBALL` override
  rejected `http://`, and neither path looked at where a redirect landed. Only the
  landing URL is checked; `release.yml`'s own fetch of the same archive is stricter
  (`curl --proto-redir '=https'`, every hop).

CI refuses to publish unless the pin it just wrote is well formed and names the
commit being released, so the "absent pin" branch is unreachable from a published
artifact — it means a git checkout, where the answer is `pnpm start`.
`AGENTROOM_ALLOW_UNVERIFIED_SOURCE=1` is the documented, loud opt-out for that one
case; there is no opt-out for a digest **mismatch**.

Accepted cost: GitHub generates `/archive/` tarballs on demand, and their bytes are
stable only by convention — GitHub changed the gzip settings once, in 2023, which
changed every auto-generated tarball's checksum. If that recurs, published versions
fail closed with an integrity error pointing at the git quickstart, and the fix is a
new patch release. We take that over trusting a mutable name.

**A release that could not publish reported success.** `publish-npm` downgraded a
missing `NPM_TOKEN` to a `::notice` and skipped, so v1.5.0 and v1.6.0 — the only two
tags cut since this ADR's job was added; earlier tags had no npm publish step at all —
each produced a green run and a GitHub Release while publishing nothing to npm,
unnoticed, with the README pointing every reader at `npx agentroom`. The skip branch
is gone. A `publish-preflight` job now requires the secret **before** `release`
creates anything, so the ordinary failure (no token) stops the run while nothing
user-visible exists; a later failure (registry down, name unavailable) leaves a
GitHub Release and a red run, which is recoverable by re-running the job on the tag
and is reported rather than hidden.

## Alternatives considered

- **Bundle the prebuilt app into the tarball** — rejected: constraints 1–2 make the
  tarball enormous, platform-entangled, and fragile (native `better-sqlite3`,
  non-relocatable `.next`).
- **Publish the workspace libraries** (Changesets, tsc builds) — rejected for
  launch: high machinery cost, no user demand; the user need is "run the app".
- **GitHub release assets only** — rejected as primary: not a registry artifact,
  no provenance, no `npx` path.
