-- ============================================================
-- AgentRoom MVP — Initial Schema
-- Migration: 20260508000001_initial_schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Helper: updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================================
-- TABLE: rooms
-- ============================================================
CREATE TABLE public.rooms (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  slug                 text,
  room_type            text NOT NULL DEFAULT 'group',
  reply_mode           text NOT NULL DEFAULT 'everyone',
  max_agent_rounds     int  NOT NULL DEFAULT 3,
  max_agent_hops       int  NOT NULL DEFAULT 6,
  allow_agent_to_agent boolean NOT NULL DEFAULT true,
  visibility           text NOT NULL DEFAULT 'private',
  last_message_at      timestamptz,
  created_by_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT NOW(),
  updated_at           timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX rooms_created_by_idx      ON public.rooms (created_by_user_id);
CREATE INDEX rooms_last_message_at_idx ON public.rooms (last_message_at DESC NULLS LAST);

CREATE TRIGGER rooms_updated_at
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TABLE: agents
-- ============================================================
CREATE TABLE public.agents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  slug               text NOT NULL,
  avatar_url         text,
  provider           text NOT NULL,
  adapter_type       text NOT NULL DEFAULT 'subprocess',
  model              text,
  system_prompt      text,
  reply_policy       text NOT NULL DEFAULT 'reply_when_invoked',
  is_active          boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT NOW(),
  updated_at         timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT agents_owner_slug_unique UNIQUE (created_by_user_id, slug)
);

CREATE INDEX agents_created_by_idx ON public.agents (created_by_user_id);
CREATE INDEX agents_provider_idx   ON public.agents (provider);
CREATE INDEX agents_active_idx     ON public.agents (is_active);

CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TABLE: room_members
-- ============================================================
CREATE TABLE public.room_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid NOT NULL REFERENCES public.rooms(id)  ON DELETE CASCADE,
  member_type text NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id    uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member',
  reply_enabled boolean NOT NULL DEFAULT true,
  muted       boolean NOT NULL DEFAULT false,
  joined_at   timestamptz NOT NULL DEFAULT NOW(),
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT room_members_type_check CHECK (
    (member_type = 'user'  AND user_id  IS NOT NULL AND agent_id IS NULL) OR
    (member_type = 'agent' AND agent_id IS NOT NULL AND user_id  IS NULL)
  ),
  CONSTRAINT room_members_user_unique  UNIQUE (room_id, user_id),
  CONSTRAINT room_members_agent_unique UNIQUE (room_id, agent_id)
);

CREATE INDEX room_members_room_idx  ON public.room_members (room_id);
CREATE INDEX room_members_user_idx  ON public.room_members (user_id);
CREATE INDEX room_members_agent_idx ON public.room_members (agent_id);

CREATE TRIGGER room_members_updated_at
  BEFORE UPDATE ON public.room_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TABLE: messages
-- ============================================================
CREATE TABLE public.messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          uuid NOT NULL REFERENCES public.rooms(id)  ON DELETE CASCADE,
  sender_type      text NOT NULL,
  sender_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_agent_id  uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  content          text NOT NULL DEFAULT '',
  content_type     text NOT NULL DEFAULT 'text',
  reply_to_id      uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  thread_id        uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  mentions         jsonb NOT NULL DEFAULT '[]',
  target_agent_ids jsonb NOT NULL DEFAULT '[]',
  round_index      int  NOT NULL DEFAULT 0,
  is_partial       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX messages_room_created_idx  ON public.messages (room_id, created_at DESC);
CREATE INDEX messages_room_turn_idx     ON public.messages (room_id, round_index);
CREATE INDEX messages_thread_idx        ON public.messages (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX messages_reply_to_idx      ON public.messages (reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX messages_sender_agent_idx  ON public.messages (sender_agent_id) WHERE sender_agent_id IS NOT NULL;
CREATE INDEX messages_mentions_gin      ON public.messages USING GIN (mentions);
CREATE INDEX messages_target_agents_gin ON public.messages USING GIN (target_agent_ids);

CREATE TRIGGER messages_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TABLE: agent_runs
-- ============================================================
CREATE TABLE public.agent_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid NOT NULL REFERENCES public.rooms(id)  ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  trigger_msg_id  uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'queued',
  round_index     int  NOT NULL DEFAULT 0,
  error_message   text,
  partial_content text,
  worker_id       text,
  heartbeat_at    timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_runs_status_created_idx ON public.agent_runs (status, created_at);
CREATE INDEX agent_runs_room_turn_idx      ON public.agent_runs (room_id, round_index);
CREATE INDEX agent_runs_trigger_idx        ON public.agent_runs (trigger_msg_id) WHERE trigger_msg_id IS NOT NULL;
CREATE INDEX agent_runs_agent_idx          ON public.agent_runs (agent_id);
CREATE INDEX agent_runs_heartbeat_idx      ON public.agent_runs (heartbeat_at) WHERE heartbeat_at IS NOT NULL;

CREATE TRIGGER agent_runs_updated_at
  BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TABLE: tool_calls
-- ============================================================
CREATE TABLE public.tool_calls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  room_id      uuid NOT NULL REFERENCES public.rooms(id)      ON DELETE CASCADE,
  tool_name    text NOT NULL,
  input_args   jsonb NOT NULL DEFAULT '{}',
  output       jsonb,
  status       text NOT NULL DEFAULT 'pending',
  approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER tool_calls_updated_at
  BEFORE UPDATE ON public.tool_calls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TABLE: files
-- ============================================================
CREATE TABLE public.files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          uuid NOT NULL REFERENCES public.rooms(id)  ON DELETE CASCADE,
  uploader_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filename         text NOT NULL,
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL DEFAULT 0,
  storage_path     text NOT NULL,
  storage_bucket   text NOT NULL DEFAULT 'room-files',
  message_id       uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER files_updated_at
  BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TABLE: pinned_items
-- ============================================================
CREATE TABLE public.pinned_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid NOT NULL REFERENCES public.rooms(id)    ON DELETE CASCADE,
  message_id  uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  pinned_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER pinned_items_updated_at
  BEFORE UPDATE ON public.pinned_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Helper function: is_room_user_member
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_room_user_member(room_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_members.room_id = $1
      AND room_members.user_id = auth.uid()
      AND room_members.member_type = 'user'
  );
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_calls   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pinned_items ENABLE ROW LEVEL SECURITY;

-- rooms
CREATE POLICY "rooms_select" ON public.rooms
  FOR SELECT USING (public.is_room_user_member(id));

-- agents: readable by any authenticated user (agents are global)
CREATE POLICY "agents_select" ON public.agents
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- room_members
CREATE POLICY "room_members_select" ON public.room_members
  FOR SELECT USING (public.is_room_user_member(room_id));

-- messages
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING (public.is_room_user_member(room_id));

-- agent_runs
CREATE POLICY "agent_runs_select" ON public.agent_runs
  FOR SELECT USING (public.is_room_user_member(room_id));

-- tool_calls
CREATE POLICY "tool_calls_select" ON public.tool_calls
  FOR SELECT USING (public.is_room_user_member(room_id));

-- files
CREATE POLICY "files_select" ON public.files
  FOR SELECT USING (public.is_room_user_member(room_id));

-- pinned_items
CREATE POLICY "pinned_items_select" ON public.pinned_items
  FOR SELECT USING (public.is_room_user_member(room_id));

-- ============================================================
-- Realtime publications
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tool_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.files;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pinned_items;
