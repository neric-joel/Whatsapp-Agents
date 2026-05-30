-- ============================================================
-- Phase 1 security: scope agentroom-files storage to room membership
-- ============================================================
-- Prior policies (phase9_extensions) only required `auth.uid() IS NOT NULL`,
-- so ANY authenticated user could read or write ANY file in the bucket directly
-- via the storage API. Files are uploaded under `rooms/{roomId}/{uuid}/{name}`,
-- so we can derive the room from the object path and require membership.

-- Helper: is the caller a user-member of the room that owns this object path?
-- SECURITY DEFINER so it can read room_members; auth.uid() still reflects the
-- calling user's JWT. A malformed path (or non-uuid room segment) returns false
-- rather than raising, so a bad key can never bypass the check.
CREATE OR REPLACE FUNCTION public.is_room_file_member(object_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parts text[];
  rid uuid;
BEGIN
  parts := string_to_array(object_name, '/');
  IF parts IS NULL OR array_length(parts, 1) < 3 OR parts[1] <> 'rooms' THEN
    RETURN false;
  END IF;
  BEGIN
    rid := parts[2]::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN public.is_room_user_member(rid);
END;
$$;

-- Replace the permissive policies with membership-scoped ones (read/insert),
-- and add the missing update/delete policies.
DROP POLICY IF EXISTS "room members can read files" ON storage.objects;
DROP POLICY IF EXISTS "authenticated users can upload files" ON storage.objects;
DROP POLICY IF EXISTS "room members read agentroom files" ON storage.objects;
DROP POLICY IF EXISTS "room members upload agentroom files" ON storage.objects;
DROP POLICY IF EXISTS "room members update agentroom files" ON storage.objects;
DROP POLICY IF EXISTS "room members delete agentroom files" ON storage.objects;

CREATE POLICY "room members read agentroom files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'agentroom-files' AND public.is_room_file_member(name));

CREATE POLICY "room members upload agentroom files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'agentroom-files' AND public.is_room_file_member(name));

CREATE POLICY "room members update agentroom files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'agentroom-files' AND public.is_room_file_member(name))
  WITH CHECK (bucket_id = 'agentroom-files' AND public.is_room_file_member(name));

CREATE POLICY "room members delete agentroom files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'agentroom-files' AND public.is_room_file_member(name));
