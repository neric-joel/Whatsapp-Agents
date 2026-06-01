# v1.0.0 Merge Plan — landing the hardening stack on `main`

**Author:** interactive verification session, 2026-05-31
**Base of record:** `origin/main` = `f780235` (pre-hardening), **no tags**.
**Status:** plan only — nothing merged/tagged/pushed to `main` by the session.

This document gives the **exact, verified** order to land the production-hardening
work on `main` for the `v1.0.0` tag, and resolves the `#8`-DIRTY question. Every
claim below was checked against the local git graph this session (commands shown so
you can re-verify).

---

## TL;DR (recommended)

The integrated tip **`fix/pre-v1-agents-rls-and-realtime`** (PR **#17**, head `a2073f6`)
is a **complete superset** of the entire v1.0 surface: it already contains all CI
workflows, `LICENSE`, and the re-stacked content of every phase. `main` is a clean
ancestor of it (`git merge-base --is-ancestor main <tip>` → **yes**).

So the simplest safe path is **not** a 14-step bottom-up merge. It is:

1. **Retarget PR #17 base → `main`, then merge PR #17.** Because PRs **#9–#16** are
   linear ancestors of #17's head, GitHub marks them **Merged** automatically when #17
   lands. (Then merge PR **#18** — this session's verification + a11y fix + ship kit —
   which sits on top of #17.)
2. **Close PRs #4–#8 as superseded** — they carry **nothing** `main` won't already
   have after step 1 (verified: only an obsolete `apps/web/.eslintrc.json`, replaced by
   the Phase-2 flat config). Their per-phase reviews live in `docs/reviews/` regardless.
3. **`#8`-DIRTY → retarget/close, do NOT rebase.** Rebasing the early branches to
   linearize them re-resolves the dup-commit conflicts for **zero content gain**.

A stricter per-PR alternative (merge #9→#17 individually) is in §4 for teams that want
one merge commit + one CI run per PR.

---

## 1. Verified topology

| PR | Branch | Base (GitHub) | mergeable | Ancestor of the #17 tip? |
|---|---|---|---|---|
| #4 | `harden/p0-foundation` | `main` | MERGEABLE | **no** |
| #5 | `feat/p1-security` | `harden/p0-foundation` | MERGEABLE | **no** |
| #6 | `harden/p2-quality` | `feat/p1-security` | MERGEABLE | **no** |
| #7 | `harden/p3-tests` | `harden/p2-quality` | MERGEABLE | **no** |
| #8 | `harden/p4-ux-a11y` | `harden/p3-tests` | **CONFLICTING** | **no** |
| #9 | `harden/p5-dx-docker-onboarding` | `main` | MERGEABLE | **yes** |
| #10 | `harden/p6-observability-reliability` | `main` | MERGEABLE | **yes** |
| #11 | `harden/p7-docs-oss` | `main` | MERGEABLE | **yes** |
| #12 | `harden/p8-release-scaffold` | `main` | MERGEABLE | **yes** |
| #13 | `harden/p6-edge-logger-split` | `main` | MERGEABLE | **yes** |
| #14 | `harden/p9-agent-memory` | `main` | MERGEABLE | **yes** |
| #15 | `harden/p10-agent-to-agent` | `main` | MERGEABLE | **yes** |
| #16 | `harden/p11-commands-user-agents` | `main` | MERGEABLE | **yes** |
| #17 | `fix/pre-v1-agents-rls-and-realtime` | `harden/p11-commands-user-agents` | MERGEABLE | _(is the tip)_ |
| **#18** (new) | `chore/pre-v1-verification-and-ship-kit` | `main` _(open it)_ | — | descends from #17 |

**Two segments.** `#9→#17` is a clean linear chain (each branch ⊆ the next). `#4→#8`
is a separate stacked chain that is **not** ancestral to the tip — its content was
**re-stacked** into the `#9` base during the 2026-05-30 pivot, so the tip has the
*content* but not the *commits*.

**The tip is a complete superset (the important part):**

```bash
git merge-base --is-ancestor main fix/pre-v1-agents-rls-and-realtime   # → yes (FF possible)
git ls-tree -r --name-only fix/pre-v1-agents-rls-and-realtime | grep '^\.github/'
#   → 12 files incl. ci.yml, security.yml, codeql (via security.yml), e2e.yml,
#     db-tests.yml, docker.yml, release.yml  ← full CI is ON THE TIP
git cat-file -e fix/pre-v1-agents-rls-and-realtime:LICENSE && echo "LICENSE present"
# p1–p4 files NOT on the tip:
comm -23 <(git ls-tree -r --name-only harden/p4-ux-a11y|sort) \
         <(git ls-tree -r --name-only fix/pre-v1-agents-rls-and-realtime|sort)
#   → (empty)        p2/p3/p4 add nothing the tip lacks
#   → p0/p1 only add apps/web/.eslintrc.json  (obsolete; replaced by eslint.config.mjs)
```

> **Correction to an earlier PROGRESS note.** Older notes said "#4 must merge to bring
> CI to `main`." That predates the #17 tip. **CI is already on the tip**, so merging the
> tip brings the full `.github/` + CI. #4 is therefore *not* required for CI.

---

## 2. `#8`-DIRTY resolution — retarget/close, not rebase

PR #8 (`harden/p4-ux-a11y` → `harden/p3-tests`) is `CONFLICTING`. Root cause (from
PROGRESS): the 2026-05-30 "Node-22 on all 6 branches" pass created **duplicate commits**
across the `#4–#8` chain that touch the same files, so adjacent branches no longer merge
cleanly. This is also why GitHub never fired `pull_request` CI on the early stack.

**Recommendation: retarget-to-`main` / close-as-superseded — do NOT rebase.**

- **Rebase (rejected):** linearising `#4→#8` means rewriting five branches and manually
  re-resolving the dup-commit conflicts on every adjacent pair. It buys **nothing**: the
  reviewed tip already contains all of their content (verified above). High effort, real
  regression risk, no payoff.
- **Retarget/close (recommended):** the `#9` base was already retargeted to `main` during
  the pivot and carries the re-stacked `p0–p4` content. Land the clean `#9→#17` chain and
  **close `#4–#8`** with a comment that their content + reviews are integrated via the
  re-stack. Zero conflict resolution; the swept tip is the source of truth.

---

## 3. Recommended steps (gh — authenticated as `neric-joel`)

> Branch protection on `main` requires a PR + green checks, so these go through PRs
> (no direct push/FF to `main`).

```bash
# 0. Push this session's branch and open PR #18 (verification + a11y fix + ship kit).
git push -u origin chore/pre-v1-verification-and-ship-kit
gh pr create --base main --head chore/pre-v1-verification-and-ship-kit \
  --title "chore: pre-v1.0 verification, a11y fix & ship kit" \
  --body "R1 live-DB verification, authenticated-axe fix (WCAG AA), CHANGELOG v1.0.0, MERGE_PLAN, deferred-gates ADR. Built on #17."

# 1. Land the clean chain by merging the tip. Retarget #17 to main, confirm green, merge.
gh pr edit 17 --base main
gh pr checks 17 --watch            # required checks green; `audit` may stay red (D3)
gh pr merge 17 --merge             # merge commit; #9–#16 auto-mark Merged (ancestors)

# 2. Merge this session's follow-up (sits on #17's head; clean after step 1).
gh pr checks 18 --watch
gh pr merge 18 --merge

# 3. Close the superseded early stack (content already on main via the re-stack).
for n in 4 5 6 7 8; do
  gh pr close $n --comment "Superseded: content + review integrated via the re-stacked #9→#17 chain (see docs/production-hardening/MERGE_PLAN.md). Closing to land the clean linear stack; reviews preserved in docs/reviews/."
done

# 4. Verify the merged main, then tag (see §5 + ship checklist).
git fetch origin && git checkout main && git pull --ff-only
```

If `gh` is ever unavailable, the paste-ready equivalents are: retarget #17 in the PR
"Edit" UI (base → `main`), **Merge pull request**, repeat for #18, then **Close** #4–#8
with the comment above.

---

## 4. Alternative — strict per-PR bottom-up of the clean chain

If you want one merge commit + one CI run **per PR** (full per-phase trail on `main`):

```bash
# #9–#16 already target main and are linear ancestors of each other, so each merges
# cleanly in turn (each shrinks the next one's diff). #17 then merges last.
for n in 9 10 11 12 13 14 15 16; do
  gh pr checks $n --watch && gh pr merge $n --merge
done
gh pr edit 17 --base main && gh pr checks 17 --watch && gh pr merge 17 --merge
gh pr merge 18 --merge
# Then close #4–#8 as in §3 step 3.
```

This is purely cosmetic (more merge commits); the resulting `main` tree is identical to
§3. Do **not** interleave `#4–#8` into this loop — they are not ancestors and will
conflict.

---

## 5. After the stack is on `main` (these steps are the owner's)

1. **Confirm GitHub CI is green on merged `main`** — `verify` / `build-images` /
   `Playwright` / `rls` / `db-tests` / `secret-scan` / `codeql` / `CodeQL` PASS; the
   `audit` job may stay red (deferred per D3 — see the deferred-gates ADR).
2. **Re-run the adversarial sweep on merged `main`** (the GO was on the proxy tip, not a
   byte-identical merged `main` — sweep caveat #1). Expect no new Critical/High.
3. **Confirm the license** (ADR-0008 = MIT, "owner may revisit before v1.0").
4. **Tag** `v1.0.0` on the merged, green `main` — `release.yml` fires only on a
   human-pushed `v*.*.*` tag and publishes the GitHub Release.

See `docs/adr/0009-v1.0.1-deferred-gates.md` for what is explicitly **not** gating the
tag (so you can tag now with documented gaps, or wait).
