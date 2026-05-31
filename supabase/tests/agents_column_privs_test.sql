-- pgTAP test for R1: column-level read privileges on public.agents.
-- Run with: supabase test db   (requires the local Supabase stack; also runs in
-- CI via .github/workflows/db-tests.yml). Wrapped in BEGIN/ROLLBACK — no state kept.
--
-- Proves, acting as a normal authenticated browser user (publishable key → the
-- `authenticated` role with an RLS-passing JWT):
--   * the safe agent columns are still readable (the global roster keeps working)
--   * `system_prompt` and `tool_permissions` are NOT readable — including the
--     caller's OWN agent and via `SELECT *` — closing the cross-tenant exposure
--   * a privileged role (service-role / superuser, the API path) can still read them

BEGIN;
SELECT plan(6);

-- Seed as the test superuser (bypasses RLS + column grants for setup).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.agents (id, name, slug, provider, system_prompt, tool_permissions, created_by_user_id)
VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Ag', 'ag', 'mock',
  'SECRET persona prompt', '{"fs":true}'::jsonb,
  '00000000-0000-0000-0000-0000000000a1'
)
ON CONFLICT (id) DO NOTHING;

-- Act as the authenticated browser role (this user owns the agent above — proving
-- the columns are hidden even from the creator's browser client, not just others').
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Safe columns: still readable (roster / AgentsPanel keep working).
SELECT lives_ok(
  $$ SELECT id, name, slug, avatar_url, provider, adapter_type, model,
            reply_policy, is_active, created_by_user_id, capabilities,
            created_at, updated_at FROM public.agents $$,
  'authenticated can read the safe agent columns (global roster still works)'
);
SELECT is(
  (SELECT name FROM public.agents WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'Ag',
  'authenticated reads a safe column value'
);

-- Sensitive columns: denied (SQLSTATE 42501 insufficient_privilege).
SELECT throws_ok(
  $$ SELECT system_prompt FROM public.agents WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  '42501',
  'authenticated CANNOT read agents.system_prompt'
);
SELECT throws_ok(
  $$ SELECT tool_permissions FROM public.agents WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  '42501',
  'authenticated CANNOT read agents.tool_permissions'
);
-- SELECT * pulls the revoked columns, so the whole-row read is denied too.
SELECT throws_ok(
  $$ SELECT * FROM public.agents $$,
  '42501',
  'authenticated SELECT * on agents is denied (covers the sensitive columns)'
);

RESET ROLE;

-- The service-role / API path (here, the privileged test role) is unaffected.
SELECT is(
  (SELECT system_prompt FROM public.agents WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'SECRET persona prompt',
  'a privileged role (service-role / API path) can still read system_prompt'
);

SELECT * FROM finish();
ROLLBACK;
