-- Phase 9 — In-product agent memory (Hermes-style, Postgres FTS).
-- Additive migration: two new tables, no changes to existing tables.
--
-- Security model (mirrors the project invariant "the browser/agent never writes
-- tables directly"):
--   * NO INSERT/UPDATE/DELETE policies for the authenticated role on either table
--     → only the service-role API/bridge may write (exactly like agent_runs).
--   * SELECT is membership-scoped via is_room_user_member() / own-row.
--   * Stored memory is DATA: recall renders it as quoted, non-instruction text;
--     the bridge injection-scans + sanitizes every write before it lands here.

-- ---------------------------------------------------------------------------
-- Helper: can the current authenticated user read a given agent's GLOBAL memory?
-- True when the user shares at least one room with that agent. Room-scoped memory
-- uses is_room_user_member() directly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_read_agent_memory(p_agent_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_members rm_agent
    JOIN public.room_members rm_user ON rm_user.room_id = rm_agent.room_id
    WHERE rm_agent.agent_id = p_agent_id
      AND rm_agent.member_type = 'agent'
      AND rm_user.user_id = auth.uid()
      AND rm_user.member_type = 'user'
  );
$$;

-- ---------------------------------------------------------------------------
-- agent_memory
--   * agent_id NULL  → room-shared memory (e.g. a user's /remember note), readable
--     by any member of room_id and recalled for every agent in that room.
--   * agent_id set   → that agent's curated memory.
--   * scope = 'room'   requires room_id (membership-scoped read).
--   * scope = 'global' requires agent_id (cross-room agent memory; read via
--     can_read_agent_memory()).
-- ---------------------------------------------------------------------------
CREATE TABLE public.agent_memory (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          uuid REFERENCES public.agents(id)   ON DELETE CASCADE,
  room_id           uuid REFERENCES public.rooms(id)    ON DELETE CASCADE,
  scope             text NOT NULL DEFAULT 'room',
  kind              text NOT NULL DEFAULT 'fact',
  title             text,
  content           text NOT NULL,
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confidence        numeric(3, 2) NOT NULL DEFAULT 0.50,
  pinned            boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  injection_flagged boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW(),
  search_tsv        tsvector GENERATED ALWAYS AS (
                      to_tsvector(
                        'english',
                        coalesce(title, '') || ' ' || coalesce(content, '')
                      )
                    ) STORED,
  CONSTRAINT agent_memory_scope_chk CHECK (scope IN ('global', 'room')),
  CONSTRAINT agent_memory_kind_chk  CHECK (kind IN ('fact', 'preference', 'skill', 'episodic')),
  CONSTRAINT agent_memory_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  -- room-scoped rows must name a room; global rows are either an agent's
  -- cross-room memory (agent_id) or a user's personal cross-room note
  -- (created_by_user_id, e.g. `/remember --global`).
  CONSTRAINT agent_memory_scope_shape_chk CHECK (
    (scope = 'room'   AND room_id IS NOT NULL) OR
    (scope = 'global' AND (agent_id IS NOT NULL OR created_by_user_id IS NOT NULL))
  )
);

CREATE INDEX agent_memory_search_gin  ON public.agent_memory USING GIN (search_tsv);
CREATE INDEX agent_memory_room_active_idx ON public.agent_memory (room_id, is_active) WHERE is_active;
CREATE INDEX agent_memory_agent_idx    ON public.agent_memory (agent_id) WHERE agent_id IS NOT NULL;

CREATE TRIGGER agent_memory_updated_at
  BEFORE UPDATE ON public.agent_memory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

-- Read-only for the browser, membership-scoped. No write policies → service role only.
CREATE POLICY "agent_memory_select" ON public.agent_memory
  FOR SELECT USING (
    (scope = 'room'   AND room_id IS NOT NULL AND public.is_room_user_member(room_id))
    OR
    (scope = 'global' AND agent_id IS NOT NULL AND public.can_read_agent_memory(agent_id))
    OR
    (scope = 'global' AND created_by_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- user_profile — the Hermes USER.md analog. Read only by its owner; agents read
-- it (via the service role) only when consented = true. Service-role write only.
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_profile (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  summary    text,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  consented  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER user_profile_updated_at
  BEFORE UPDATE ON public.user_profile
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profile_select_own" ON public.user_profile
  FOR SELECT USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Ranked full-text recall. Returns the active memory visible to (agent within
-- room): the agent's own room/global memory plus room-shared (agent_id IS NULL)
-- notes, ranked by ts_rank against the query. SECURITY INVOKER so RLS still
-- applies to any non-service caller; EXECUTE is restricted to the service role
-- (the bridge + the web API call it after an app-layer membership check).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recall_agent_memory(
  p_agent_id uuid,
  p_room_id uuid,
  p_query text,
  p_limit int DEFAULT 8,
  p_user_id uuid DEFAULT NULL
)
RETURNS SETOF public.agent_memory
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.*
  FROM public.agent_memory m
  WHERE m.is_active
    AND (
      -- room-shared notes + this agent's room memory
      (m.scope = 'room' AND m.room_id = p_room_id
        AND (p_agent_id IS NULL OR m.agent_id = p_agent_id OR m.agent_id IS NULL))
      -- this agent's global memory
      OR (m.scope = 'global' AND p_agent_id IS NOT NULL AND m.agent_id = p_agent_id)
      -- the triggering user's personal global notes
      OR (m.scope = 'global' AND p_user_id IS NOT NULL AND m.created_by_user_id = p_user_id)
    )
    AND (
      p_query IS NULL OR p_query = ''
      OR m.search_tsv @@ websearch_to_tsquery('english', p_query)
    )
  ORDER BY
    m.pinned DESC,
    CASE
      WHEN p_query IS NULL OR p_query = '' THEN 0
      ELSE ts_rank(m.search_tsv, websearch_to_tsquery('english', p_query))
    END DESC,
    m.confidence DESC,
    m.created_at DESC
  LIMIT GREATEST(coalesce(p_limit, 8), 1);
$$;

REVOKE ALL ON FUNCTION public.recall_agent_memory(uuid, uuid, text, int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recall_agent_memory(uuid, uuid, text, int, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Realtime: the Memory panel subscribes to agent_memory changes (mirrors
-- pinned_items). RLS still applies to realtime subscribers. user_profile is not
-- broadcast.
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_memory;
