-- Phase 10 — first-class agent-to-agent interaction.
-- Additive: a short per-agent capability blurb so peers can address each other
-- deliberately (injected into ContextPacketV1.roster as DATA). Hand-offs reuse
-- the existing agent_runs deliberation columns (round_index, deliberation_depth,
-- deliberation_root_id) for loop-guard math + cycle detection — no new table.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS capabilities text;

COMMENT ON COLUMN public.agents.capabilities IS
  'Short persona/skill blurb shown to peer agents in the room roster (Phase 10). Plain text, treated as data.';

-- Give the seeded agents a capability blurb so the roster is meaningful out of the
-- box (no-op if these slugs are absent in a given environment).
UPDATE public.agents SET capabilities = 'Reasons through problems and proposes approaches; strong at planning and trade-offs.'
  WHERE slug = 'claude_thinker' AND capabilities IS NULL;
UPDATE public.agents SET capabilities = 'Implements solutions in code; turns a plan into concrete steps and diffs.'
  WHERE slug = 'codex_builder' AND capabilities IS NULL;
UPDATE public.agents SET capabilities = 'Reviews for risks, edge cases, and correctness; challenges proposals.'
  WHERE slug = 'reviewer' AND capabilities IS NULL;
