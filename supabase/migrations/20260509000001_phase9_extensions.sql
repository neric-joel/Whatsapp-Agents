ALTER TABLE public.pinned_items
  ALTER COLUMN message_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS pin_type text NOT NULL DEFAULT 'context',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS content text,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.tool_calls
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id),
  ADD COLUMN IF NOT EXISTS tool_category text,
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS error text;

ALTER TABLE public.files
  ALTER COLUMN storage_bucket SET DEFAULT 'agentroom-files',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS extracted_text text;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS tool_permissions jsonb NOT NULL DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('agentroom-files', 'agentroom-files', false, 52428800)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'room members can read files'
  ) THEN
    CREATE POLICY "room members can read files"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'agentroom-files' AND auth.uid() IS NOT NULL);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'authenticated users can upload files'
  ) THEN
    CREATE POLICY "authenticated users can upload files"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'agentroom-files' AND auth.uid() IS NOT NULL);
  END IF;
END
$$;
