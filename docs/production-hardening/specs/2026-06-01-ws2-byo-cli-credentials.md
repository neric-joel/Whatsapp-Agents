# WS2 — Hermes-style "bring your own CLI / API key" credentials (DESIGN SPEC)

**Date:** 2026-06-01 · **Status:** PROPOSED (awaiting owner approval — no code yet)
**Owner decisions (locked):** (1) **per-user keychain** ownership; (2) v1 scope =
**custom CLI + env-var injection** (any CLI the user brings — the core of the product:
connecting different CLIs into chat rooms). HTTP API-key providers = later follow-up.

---

## 1. Problem / gap

Agents are created with `provider`/`adapter_type` but there is **no in-product way for a
user to supply a credential**. Real CLIs authenticate via their own host login + `*_BIN`;
`buildChildEnv()` reads provider keys only from the **bridge's** `process.env` (global) and
strips secrets. So a user can't register their own CLI + key through the product. Hermes
solves this with a per-user provider/auth store resolved at runtime. We mirror that.

## 2. What already exists (extend, don't duplicate)

- `bridge/src/lib/subprocess-security.ts` → `buildChildEnv(source)`: strips
  `SECRET_ENV_PATTERN`, allows `BASE_ENV_KEYS` + `PROVIDER_ENV_PATTERN`
  (`ANTHROPIC_|OPENAI_|CODEX_|…`) + `BRIDGE_CHILD_ENV_ALLOW`. Reads `process.env` by default.
- `SubprocessAdapter` (shell:false, static `buildArgs`, stdin-only packet, output cap,
  kill-tree). `registry.ts` maps `adapter_type` → adapter.
- `agents` table: `provider`, `adapter_type`, `created_by_user_id`, `system_prompt`
  (R1 column-REVOKE pattern already proven for sensitive columns).
- `redact()` over all persisted log/content; RLS write-isolation (no authenticated writes).

## 3. Approaches considered

**Agent → credential link**
- **(A) `agents.credential_id` FK → `agent_credentials`** *(recommended)*. Explicit, doesn't
  overload `provider`; null = today's behavior (host-login adapters) unchanged.
- (B) Match by `(created_by_user_id, provider)` string. Implicit/magical; ambiguous when a
  user has two keys for one provider.

**Secret at rest**
- **(A) App-layer AES-256-GCM** *(recommended)* with a 32-byte key from a new env var
  `CREDENTIAL_ENCRYPTION_KEY` (bridge + web), never in the DB. Portable to any self-host, no
  Postgres extension. Decrypt only in the bridge (service-role) at spawn.
- (B) Supabase Vault (pgsodium). Stronger key mgmt but adds an extension + migration coupling;
  good **v1.1** upgrade.
- (C) Plaintext column + grant-revoke only. Rejected (plaintext at rest).

**Secret confidentiality from the client** — mirror **R1**: `REVOKE SELECT
(secret_ciphertext)` from `anon`/`authenticated`; the column is service-role-only. Even the
owner's browser never reads the secret; the API returns metadata only.

## 4. Data model (additive migration)

```sql
create table public.agent_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,                       -- display, e.g. "My OpenRouter key"
  provider_key text not null,                -- free-form id the user gives the provider
  bin_path text,                             -- optional custom CLI absolute path (validated)
  env_var_name text not null,                -- the ONE env var the CLI reads (e.g. OPENAI_API_KEY)
  secret_ciphertext text not null,           -- AES-256-GCM(secret) — NEVER plaintext
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, provider_key)
);
alter table public.agents add column credential_id uuid
  references public.agent_credentials(id) on delete set null;

alter table public.agent_credentials enable row level security;
-- Owner-only READ; matches the write-isolation invariant (no authenticated INSERT/
-- UPDATE/DELETE policy — every write goes through the service-role API after an
-- auth.uid()==owner check, exactly like agent_runs/agents).
create policy cred_owner_select on public.agent_credentials
  for select using (auth.uid() = owner_user_id);
-- R1-style column REVOKE: the client may read metadata, never the ciphertext.
revoke select on public.agent_credentials from anon, authenticated;
grant  select (id, owner_user_id, label, provider_key, bin_path, env_var_name,
               created_at, updated_at) on public.agent_credentials to authenticated;
-- (writes still go through the service-role API, not the browser, per the write-path rule)
```

**Validation:** `env_var_name` must match `^[A-Z][A-Z0-9_]*$` (a real env name, no injection);
`bin_path` must be an absolute path that resolves (reuse `resolveBinaryPath`); `label`/
`provider_key` length-bounded. Secret length-bounded (e.g. ≤ 8 KB).

## 5. Runtime resolution + per-run injection (the security core)

- `resolveRuntimeProvider(agentRow, serviceClient)` (new, bridge): if
  `agentRow.credential_id` is set, load the credential via **service-role**, AES-GCM-decrypt
  the secret, return `{ binPath, envVarName, secret }`; else `null` (unchanged path).
- `buildChildEnv` gains an **explicit, single-var injection** seam:
  `buildChildEnv(source, { inject?: { name, value } })` — `inject` is applied **after** the
  strip/allowlist, so exactly the ONE resolved credential var is added to **this** child,
  for **this** run, regardless of `SECRET_ENV_PATTERN`. `process.env` secrets stay stripped.
- The adapter (a generic `custom-cli` adapter, or `SubprocessAdapter` given a runtime
  `binPath`/`envVarName`) uses `binPath` as the resolved command and injects
  `{ [envVarName]: secret }`. **`buildArgs` stays static** (stdin-only packet) — args never
  come from the packet or the credential in v1.

**Invariants preserved:** `shell:false`; static argv; system_prompt/packet via stdin only;
the secret is (a) never in argv, (b) never logged (`redact()` + it's only ever in the child
env, not in any logged object), (c) injected only into the one chosen child — never another
adapter's env, (d) unreadable cross-user (RLS) and never returned to any browser (column
REVOKE). Cost/usage note: an agent created by user A with A's credential spends A's key
whenever it replies (even when triggered by another room member) — documented behavior of a
per-user keychain.

## 6. API + UI

- `POST /api/credentials` (authn + CSRF + rate-limit + zod): create; stores ciphertext;
  returns metadata only (never the secret). `GET /api/credentials`: the caller's own
  credentials, metadata only. `DELETE /api/credentials/[id]`: owner-only.
- `createAgentSchema` gains optional `credential_id`; the create route verifies the
  credential belongs to the caller before linking.
- UI: a "Providers & keys" settings panel (add/list/delete) + a credential picker in
  `CreateAgentForm` (optional). The secret input is write-only (never populated on edit).

## 7. Tests + security red-team (DONE gate)

- Unit: AES-GCM round-trip; `env_var_name`/`bin_path` validation; `buildChildEnv` inject seam
  (the injected var is present; `process.env` secrets still stripped; a different call without
  inject has no secret).
- Integration: a `custom-cli` agent with a credential resolves + injects the env var; a
  null-credential agent is unchanged.
- **Red-team (Security-Auditor `/critique` PASS required):** (1) argv/ps scan — secret absent
  from the spawned process command line; (2) log scan — secret absent from bridge + web logs
  (passes `redact()`); (3) cross-adapter — a mock/other adapter's child env has no secret;
  (4) cross-user — user B cannot read user A's credential (RLS) and `GET /api/credentials`
  never returns ciphertext/plaintext; (5) a real reply from a newly-registered provider.

## 8. Out of scope (v1 → follow-ups)

HTTP API-key providers (new `http-api` adapter); multi-key rotation strategies
(`fill_first`/`round_robin`); OAuth device flows; per-credential custom argv. Tracked for v1.1.

## 9. Migration / rollback

Additive migration (new table + nullable `agents.credential_id`); reversible by drop. New env
var `CREDENTIAL_ENCRYPTION_KEY` (documented in `.env.example` + SELF_HOSTING; the feature is
inert/disabled with a clear boot error if a credential exists but the key is unset).
