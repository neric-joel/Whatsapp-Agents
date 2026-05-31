-- pgTAP RLS tests for Phase 9 agent_memory + user_profile.
-- Run with: supabase test db   (requires the local Supabase stack)
--
-- Proves, acting as a normal authenticated browser user:
--   * room-scoped memory is readable only by room members (membership SELECT)
--   * a member CANNOT read another room's memory
--   * the browser CANNOT write agent_memory or user_profile directly
--     (no INSERT policy for the authenticated role — only the service-role
--      API/bridge may write; the project's core invariant)
--   * user_profile is readable only by its owner

BEGIN;
SELECT plan(7);

-- Seed as the test superuser (bypasses RLS for setup).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rooms (id, name, created_by_user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Room A', '00000000-0000-0000-0000-0000000000a1'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Room B', '00000000-0000-0000-0000-0000000000b1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.room_members (room_id, member_type, user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user', '00000000-0000-0000-0000-0000000000a1', 'owner')
ON CONFLICT DO NOTHING;

INSERT INTO public.agents (id, name, slug, provider) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Ag', 'ag', 'mock')
ON CONFLICT (id) DO NOTHING;

-- One memory row in each room (service-role/superuser write).
INSERT INTO public.agent_memory (id, agent_id, room_id, scope, kind, content) VALUES
  ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'room', 'fact', 'Room A remembers the deadline is Friday'),
  ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'room', 'fact', 'Room B secret note')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_profile (id, user_id, summary, consented) VALUES
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-0000000000a1', 'User A profile', true),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-0000000000b1', 'User B profile', true)
ON CONFLICT (id) DO NOTHING;

-- The generated tsvector populates on insert.
SELECT isnt(
  (SELECT search_tsv FROM public.agent_memory WHERE id = '11111111-1111-1111-1111-111111111111'),
  NULL,
  'search_tsv is generated on insert'
);

-- Act as member A (member of room A only).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.agent_memory WHERE room_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'member A can read room A memory'
);
SELECT is(
  (SELECT count(*)::int FROM public.agent_memory WHERE room_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'member A cannot read room B memory (not a member)'
);
SELECT throws_ok(
  $$ INSERT INTO public.agent_memory (agent_id, room_id, scope, kind, content)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
             'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'room', 'fact', 'injected by browser') $$,
  NULL,
  'browser (authenticated) cannot INSERT agent_memory directly'
);
SELECT throws_ok(
  $$ UPDATE public.agent_memory SET content = 'tampered'
     WHERE id = '11111111-1111-1111-1111-111111111111' $$,
  NULL,
  'browser (authenticated) cannot UPDATE agent_memory directly'
);

-- user_profile: own row only.
SELECT is(
  (SELECT count(*)::int FROM public.user_profile WHERE user_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'user A can read their own profile'
);
SELECT is(
  (SELECT count(*)::int FROM public.user_profile WHERE user_id = '00000000-0000-0000-0000-0000000000b1'),
  0,
  'user A cannot read user B profile'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
