/**
 * What the timeline should SHOW for a message, as opposed to what is stored.
 *
 * A `/discuss` (or `/debate`) kickoff replaces the stored user-message content with
 * the built coordinator phase prompt — that text is the agents' trigger and must
 * stay in the DB untouched, but it is not what the human typed, so rendering it in
 * the user's own bubble misattributes a wall of internal prompt to them. The typed
 * command survives in server-owned `metadata.discussion.original_prompt`; rebuild
 * and show that instead. Display-only: agents, the orchestrator, and the context
 * packet all keep reading the stored content.
 */
export function userVisibleContent(
  content: string,
  senderType: string,
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (senderType !== 'user' || !metadata) return content
  const d = metadata['discussion']
  if (!d || typeof d !== 'object' || Array.isArray(d)) return content
  const disc = d as {
    enabled?: unknown
    command?: unknown
    original_prompt?: unknown
    original_input?: unknown
  }
  if (disc.enabled !== true) return content
  // Preferred: the literal typed text (stored server-side since v1.5.0) — exact for
  // both `/discuss …` and `@everyone …?` kickoffs.
  if (typeof disc.original_input === 'string' && disc.original_input.length > 0) {
    return disc.original_input
  }
  // Legacy kickoffs (pre-original_input): rebuild the slash form. For an old
  // `@everyone …?` kickoff this shows `/discuss <question>` — imperfect, but closer
  // to what was typed than the internal coordinator prompt.
  if (
    typeof disc.command === 'string' &&
    disc.command.length > 0 &&
    typeof disc.original_prompt === 'string' &&
    disc.original_prompt.length > 0
  ) {
    return `/${disc.command} ${disc.original_prompt}`
  }
  return content
}
