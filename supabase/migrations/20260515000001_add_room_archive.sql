ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
