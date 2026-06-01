-- WS2 — per-user credential keychain (bring-your-own CLI / API key). See ADR-0010.
--
-- Secrets are AES-256-GCM-encrypted at the app layer (key from CREDENTIAL_ENCRYPTION_KEY,
-- server-only) and stored as ciphertext + nonce. RLS is owner SELECT-only (mirrors
-- user_profile); all writes go through the service-role API (write-isolation invariant).
-- The secret columns are REVOKE'd from the browser roles (the R1 column-grant pattern) so
-- the client can never read them — the API returns metadata only + a computed has_secret.

CREATE TABLE public.user_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider          text NOT NULL,
  label             text NOT NULL,
  secret_ciphertext text NOT NULL,
  secret_nonce      text NOT NULL,
  base_url          text,
  is_default        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_credentials_user_idx ON public.user_credentials (user_id);
-- At most one default credential per (user, provider).
CREATE UNIQUE INDEX user_credentials_one_default
  ON public.user_credentials (user_id, provider) WHERE is_default;

CREATE TRIGGER user_credentials_updated_at
  BEFORE UPDATE ON public.user_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;

-- Owner reads own rows; no authenticated write policy (writes via service-role API).
CREATE POLICY "user_credentials_select_own" ON public.user_credentials
  FOR SELECT USING (user_id = auth.uid());

-- R1-style column REVOKE: the browser may read metadata, NEVER the secret. A table-level
-- GRANT overrides a column REVOKE, so drop the table grant and re-grant the safe columns.
REVOKE SELECT ON public.user_credentials FROM anon, authenticated;
GRANT SELECT (id, user_id, provider, label, base_url, is_default, created_at, updated_at)
  ON public.user_credentials TO authenticated;

COMMENT ON COLUMN public.user_credentials.secret_ciphertext IS
  'AES-256-GCM ciphertext of the provider secret. SELECT revoked from authenticated/anon '
  '(ADR-0010) — readable only via the service-role API and decrypted in the bridge at spawn.';
COMMENT ON COLUMN public.user_credentials.secret_nonce IS
  'AES-256-GCM nonce/IV for secret_ciphertext. SELECT revoked from authenticated/anon (ADR-0010).';

-- Agents reference a credential; the secret never lands on the agent row. NULL = host-login
-- adapter (unchanged behavior). ON DELETE SET NULL so removing a credential disables the
-- agent's BYO auth rather than deleting the agent.
ALTER TABLE public.agents
  ADD COLUMN credential_id uuid REFERENCES public.user_credentials(id) ON DELETE SET NULL;

-- credential_id is a non-sensitive FK id (not a secret) — grant it to authenticated so the
-- UI can show an agent's bound provider (agents SELECT was column-restricted in R1).
GRANT SELECT (credential_id) ON public.agents TO authenticated;
