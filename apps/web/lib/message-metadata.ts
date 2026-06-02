/**
 * Strip server-owned keys from client-supplied message metadata.
 *
 * SECURITY: `metadata.discussion` is the team-collaboration blackboard (ADR-0011). It is authored
 * ONLY by the server (the messages route on kickoff, the bridge orchestrator on each phase). If a
 * client could set it on a normal message, the bridge's discussion-scoped context query +
 * orchestrator would honor a forged `original_message_id` — leaking another in-room discussion's
 * transcript into an agent's context and amplifying fan-out. The route re-adds a fresh, trusted
 * `discussion` block only for a genuine /discuss|/debate|@everyone-? request.
 */
export function stripServerOwnedMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {}
  const { discussion: _serverOwned, ...rest } = metadata as Record<string, unknown>
  return rest
}
