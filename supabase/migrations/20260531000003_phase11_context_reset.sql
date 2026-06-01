-- Phase 11 — `/reset` (admin+) clears the room's *rolling agent context* without
-- destroying any data. Instead of deleting messages (forbidden, irreversible),
-- we stamp a watermark; the bridge's context builder only includes messages at
-- or after this timestamp, so agents start fresh while the full transcript stays
-- intact and visible to users. Fully reversible: clearing the column restores
-- the prior context window.
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS context_reset_at timestamptz;

COMMENT ON COLUMN public.rooms.context_reset_at IS
  'Phase 11: rolling agent-context watermark set by /reset (admin+). The bridge includes only messages created at/after this time when building an agent context packet. NULL = no reset. Messages are never deleted.';
