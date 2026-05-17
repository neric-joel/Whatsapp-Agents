ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS discussion_mode text NOT NULL DEFAULT 'independent';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rooms_discussion_mode_check'
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_discussion_mode_check
      CHECK (discussion_mode IN ('independent', 'tag_turns'));
  END IF;
END
$$;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS discussion_mode text NOT NULL DEFAULT 'independent',
  ADD COLUMN IF NOT EXISTS deliberation_depth int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deliberation_root_id uuid REFERENCES public.agent_runs(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_discussion_mode_check'
  ) THEN
    ALTER TABLE public.agent_runs
      ADD CONSTRAINT agent_runs_discussion_mode_check
      CHECK (discussion_mode IN ('independent', 'tag_turns'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_deliberation_depth_check'
  ) THEN
    ALTER TABLE public.agent_runs
      ADD CONSTRAINT agent_runs_deliberation_depth_check
      CHECK (deliberation_depth >= 0);
  END IF;
END
$$;
