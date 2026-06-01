-- pgTAP policy tests for the core RLS invariants.
-- Run with: supabase test db   (requires the local Supabase stack)
--
-- Proves, acting as a normal authenticated browser user:
--   * room messages are readable only by members (membership-scoped SELECT)
--   * the browser CANNOT write agent_runs or messages directly
--     (no INSERT policy exists for the authenticated role — only the
--      service-role API may write). This is the README's core invariant.

BEGIN;
SELECT plan(4);

-- Seed (as the test superuser, which bypasses RLS for setup).
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
INSERT INTO public.messages (id, room_id, sender_type, sender_user_id, content, content_type)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user', '00000000-0000-0000-0000-0000000000a1', 'hello', 'text')
ON CONFLICT (id) DO NOTHING;

-- Act as member A.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.messages WHERE room_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'member A can read room A messages'
);
SELECT is(
  (SELECT count(*)::int FROM public.messages WHERE room_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'member A cannot read room B messages (not a member)'
);
SELECT throws_ok(
  $$ INSERT INTO public.agent_runs (room_id, agent_id, status)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'queued') $$,
  NULL,
  'browser (authenticated) cannot INSERT agent_runs'
);
SELECT throws_ok(
  $$ INSERT INTO public.messages (room_id, sender_type, content, content_type)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user', 'x', 'text') $$,
  NULL,
  'browser (authenticated) cannot INSERT messages directly'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
