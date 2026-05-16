create unique index if not exists messages_discussion_phase_unique
on public.messages (
  room_id,
  ((metadata->'discussion'->>'original_message_id')),
  ((metadata->'discussion'->>'phase'))
)
where metadata ? 'discussion'
  and metadata->'discussion'->>'enabled' = 'true'
  and metadata->'discussion'->>'original_message_id' is not null
  and metadata->'discussion'->>'phase' is not null;
