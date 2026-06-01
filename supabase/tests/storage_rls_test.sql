-- pgTAP policy test for room-scoped storage access.
-- Run with: supabase test db   (requires the local Supabase stack)
--
-- Proves: a user who is a member of room A can access files under
-- rooms/A/... but NOT files under rooms/B/... (a room they do not belong to).

BEGIN;
SELECT plan(6);

-- Seed two rooms, two users, and membership only in room A for user A.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'member-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'member-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rooms (id, name, created_by_user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Room A', '00000000-0000-0000-0000-0000000000a1'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Room B', '00000000-0000-0000-0000-0000000000b1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.room_members (room_id, member_type, user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'user', '00000000-0000-0000-0000-0000000000b1', 'owner')
ON CONFLICT DO NOTHING;

-- Act as user A.
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

SELECT ok(
  public.is_room_file_member('rooms/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/abc/file.png'),
  'member A can access own room A file'
);
SELECT ok(
  NOT public.is_room_file_member('rooms/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/abc/file.png'),
  'member A CANNOT access room B file (not a member)'
);
SELECT ok(
  NOT public.is_room_file_member('rooms/not-a-uuid/abc/file.png'),
  'malformed room id is denied (no error raised)'
);
SELECT ok(
  NOT public.is_room_file_member('file.png'),
  'object with no room prefix is denied'
);
SELECT ok(
  NOT public.is_room_file_member('rooms/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'object missing the trailing key segment is denied'
);

-- Act as user B: should only see room B.
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
SELECT ok(
  NOT public.is_room_file_member('rooms/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/abc/file.png'),
  'member B CANNOT access room A file (not a member)'
);

SELECT * FROM finish();
ROLLBACK;
