-- pgTAP for WS2 user_credentials (ADR-0010). Proves, as the browser `authenticated`
-- role: (a) a user reads only their OWN credentials' metadata (RLS row filter), (b) the
-- secret columns are NOT readable by the browser at all (column REVOKE), (c) cross-user
-- rows are invisible, and (d) the service-role/API path can still read the ciphertext.
-- Wrapped in BEGIN/ROLLBACK — no state kept.

BEGIN;
SELECT plan(6);

INSERT INTO auth.users (id, email) VALUES
  ('0a000000-0000-0000-0000-0000000000a1', 'a@test.local'),
  ('0b000000-0000-0000-0000-0000000000b2', 'b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_credentials (id, user_id, provider, label, secret_ciphertext, secret_nonce)
VALUES
  ('0c000000-0000-0000-0000-0000000000c1', '0a000000-0000-0000-0000-0000000000a1', 'openai', 'A key', 'ct-A', 'n-A'),
  ('0d000000-0000-0000-0000-0000000000d2', '0b000000-0000-0000-0000-0000000000b2', 'openai', 'B key', 'ct-B', 'n-B')
ON CONFLICT (id) DO NOTHING;

-- Act as user A's browser session.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"0a000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- (a) A reads its own metadata.
SELECT lives_ok(
  $$ SELECT id, provider, label, base_url, is_default FROM public.user_credentials
     WHERE user_id = '0a000000-0000-0000-0000-0000000000a1' $$,
  'authenticated reads its own credential metadata'
);
SELECT is(
  (SELECT label FROM public.user_credentials WHERE id = '0c000000-0000-0000-0000-0000000000c1'),
  'A key',
  'authenticated reads its own label value'
);

-- (b) The secret columns are denied at the column-grant level (SQLSTATE 42501).
SELECT throws_ok(
  $$ SELECT secret_ciphertext FROM public.user_credentials WHERE id = '0c000000-0000-0000-0000-0000000000c1' $$,
  '42501', NULL,
  'authenticated CANNOT read secret_ciphertext (own row)'
);
SELECT throws_ok(
  $$ SELECT secret_nonce FROM public.user_credentials WHERE id = '0c000000-0000-0000-0000-0000000000c1' $$,
  '42501', NULL,
  'authenticated CANNOT read secret_nonce'
);

-- (c) B's rows are invisible to A (RLS row filter). count(id) uses a granted column.
SELECT is(
  (SELECT count(id)::int FROM public.user_credentials WHERE user_id = '0b000000-0000-0000-0000-0000000000b2'),
  0,
  'authenticated cannot see another user''s credentials (RLS)'
);

RESET ROLE;

-- (d) The service-role / API path reads the ciphertext (to decrypt at spawn).
SELECT is(
  (SELECT secret_ciphertext FROM public.user_credentials WHERE id = '0c000000-0000-0000-0000-0000000000c1'),
  'ct-A',
  'a privileged role (service-role / API) can read the ciphertext'
);

SELECT * FROM finish();
ROLLBACK;
