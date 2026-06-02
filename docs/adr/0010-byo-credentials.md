# 0010 — Bring-your-own CLI / API-key credentials (per-user keychain)

- **Status:** Accepted (autonomous decision — owner pre-approved the design in the WS2
  campaign brief)
- **Date:** 2026-06-01

## Context

Agents are created with `provider`/`adapter_type` but there is no in-product way for a user
to supply a credential — real CLIs authenticate via host login + `*_BIN`, and `buildChildEnv`
reads provider keys only from the bridge's global `process.env`. The product's core is
connecting different CLIs into chat rooms, so a user must be able to bring their own
CLI/provider + key. Mirrors Hermes Agent's per-user auth store resolved at runtime.

## Decision

1. **Per-user keychain** — a new `user_credentials` table keyed on `user_id`
   (`auth.users`). RLS is **owner SELECT-only** (`user_id = auth.uid()`), mirroring
   `user_profile`; all writes go through the **service-role API** (the write-isolation
   invariant — no authenticated write policy). The secret columns
   (`secret_ciphertext`, `secret_nonce`) are **REVOKE'd from anon/authenticated** (the R1
   column-grant pattern) so the browser can never read the secret even as the owner; the API
   returns metadata only + a computed `has_secret`.
2. **Agents reference, never copy** — a nullable `agents.credential_id` FK → `user_credentials`.
   The secret never lands on the agent row. `null` = today's behavior (host-login adapters),
   unchanged.
3. **Owner brings the fuel** — at spawn the bridge resolves the credential of the agent's
   **creator** (`created_by_user_id`). So an agent created by user A with A's key spends A's
   key whenever it replies, even when triggered by another room member. (A future per-room
   "each member supplies their own key" policy is v1.1 — noted, not built.)
4. **Secret at rest — app-layer AES-256-GCM envelope** with a 32-byte server-only key from
   `CREDENTIAL_ENCRYPTION_KEY` (added to `.env.example` + zod env validation; never the
   browser, never logged). Ciphertext + nonce stored in Postgres; decrypt only in the bridge
   (service-role) at spawn. Portable to local Docker and any Postgres with no extension.
5. **Runtime resolution — `resolveRuntimeProvider()`** (shared/bridge): agent → owner's
   credential (explicit `credential_id`, else default-by-provider) → decrypt → inject **only
   the one allowlisted env var that adapter needs** into **that** child env, via an explicit
   single-var `buildChildEnv` injection seam applied AFTER the strip/allowlist. Per-adapter
   map: `claude-code → ANTHROPIC_API_KEY` (+ `CLAUDE_CODE_OAUTH_TOKEN`), `codex-cli →
   OPENAI_API_KEY` (+ optional `base_url`), `openai`/`custom` → a user-named env var + bin
   path + optional `base_url`. The key never reaches argv; `buildArgs` stays static.

## Consequences

- **Positive.** Users self-serve any CLI/provider; secrets are encrypted at rest,
  RLS-owner-scoped, never browser-readable, injected per-run into one child only. No new
  infra dependency (works on local Docker).
- **Negative / accepted.** App-layer key management (a lost `CREDENTIAL_ENCRYPTION_KEY` makes
  stored secrets unrecoverable — documented; rotate by re-entering). "Owner pays" can surprise
  if a room member triggers another's agent (documented).
- **Security gate.** Ship requires a Security-Auditor `/critique` PASS + a key-leak red-team
  (absent from argv/ps, logs/`redact()`, a different adapter's child env; unreadable
  cross-user; never returned by the API).

## Alternatives considered

- **Per-agent credential** — simpler resolution but duplicates keys + hard rotation. Rejected.
- **Per-room shared credential** — weaker isolation (members share a secret). Rejected for v1.
- **Supabase Vault (pgsodium)** — stronger managed key separation + AEAD, but adds an
  extension + the "disable statement logging during insert" caveat and couples to hosted
  Supabase. Documented as the managed-hosted alternative / v1.1 upgrade; not chosen for the
  self-host-first default.
