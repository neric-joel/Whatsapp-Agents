-- ADR-0011 — team-collaboration /discuss (plan→execute→integrate→[dissent]→converge) and the
-- adversarial /debate sibling. INDEX-ONLY migration: no new columns, no backfill.
--
-- The bridge now loads the WHOLE discussion thread by original_message_id (the parallel-blindness
-- fix in build-context-packet.ts) and scans for a per-reply `challenge` stamp (the anti-sycophancy
-- gate in discussion-orchestrator.ts). Both filter on metadata->'discussion'->>'original_message_id'.
-- This expression index backs those lookups. (The phase idempotency backstop continues to be the
-- pre-existing unique index messages_discussion_phase_unique, which generalizes unchanged to the
-- new phase strings.)
create index if not exists messages_discussion_thread_idx
  on public.messages ((metadata->'discussion'->>'original_message_id'))
  where metadata ? 'discussion';

-- ADR-0011 also stamps the discussion blackboard (including `phase`) onto each AGENT REPLY so
-- the scoped peer query can attribute contributions and the anti-sycophancy gate can read the
-- per-reply `challenge` flag. But messages_discussion_phase_unique (migration 20260516000001)
-- enforced ONE message per (room, original_message_id, phase) across ALL sender types — which
-- now collides: the coordinator's 'plan' reply vs the 'plan' trigger, and N 'execute' replies
-- with each other. That uniqueness is only meaningful for phase TRIGGER messages (sender_type
-- system|user). Recreate it scoped to trigger messages so agent replies can carry phase freely.
drop index if exists messages_discussion_phase_unique;
create unique index if not exists messages_discussion_phase_unique
  on public.messages (
    room_id,
    ((metadata->'discussion'->>'original_message_id')),
    ((metadata->'discussion'->>'phase'))
  )
  where metadata ? 'discussion'
    and metadata->'discussion'->>'enabled' = 'true'
    and metadata->'discussion'->>'original_message_id' is not null
    and metadata->'discussion'->>'phase' is not null
    and sender_type in ('system', 'user');
