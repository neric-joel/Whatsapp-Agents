-- ============================================================
-- AgentRoom MVP — Seed Data
-- ============================================================

-- 3 agents
INSERT INTO public.agents (id, name, slug, provider, adapter_type, reply_policy, is_active)
VALUES
  (
    gen_random_uuid(),
    'Claude Thinker',
    'claude_thinker',
    'claude_code',
    'subprocess',
    'reply_when_invoked',
    true
  ),
  (
    gen_random_uuid(),
    'Codex Builder',
    'codex_builder',
    'codex_cli',
    'subprocess',
    'reply_when_invoked',
    true
  ),
  (
    gen_random_uuid(),
    'Reviewer',
    'reviewer',
    'mock',
    'mock',
    'reply_when_invoked',
    true
  );

-- 1 room
INSERT INTO public.rooms (id, name, room_type, reply_mode, max_agent_rounds, max_agent_hops, allow_agent_to_agent, visibility)
VALUES (
  gen_random_uuid(),
  'My First AgentRoom',
  'group',
  'everyone',
  3,
  6,
  true,
  'private'
);

-- 3 room_members: all 3 agents added to the room
-- Uses a DO block to reference the inserted rows by slug/name
DO $$
DECLARE
  v_room_id     uuid;
  v_thinker_id  uuid;
  v_builder_id  uuid;
  v_reviewer_id uuid;
BEGIN
  SELECT id INTO v_room_id     FROM public.rooms  WHERE name = 'My First AgentRoom' LIMIT 1;
  SELECT id INTO v_thinker_id  FROM public.agents WHERE slug = 'claude_thinker'     LIMIT 1;
  SELECT id INTO v_builder_id  FROM public.agents WHERE slug = 'codex_builder'      LIMIT 1;
  SELECT id INTO v_reviewer_id FROM public.agents WHERE slug = 'reviewer'           LIMIT 1;

  INSERT INTO public.room_members (room_id, member_type, agent_id, role, reply_enabled, muted)
  VALUES
    (v_room_id, 'agent', v_thinker_id,  'member', true, false),
    (v_room_id, 'agent', v_builder_id,  'member', true, false),
    (v_room_id, 'agent', v_reviewer_id, 'member', true, false);
END
$$;
