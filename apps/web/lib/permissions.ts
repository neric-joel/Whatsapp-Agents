/**
 * RBAC gates for room actions.
 *
 * Local single-user app: the one user owns every room, so these always pass. They
 * are kept as named functions (and called at the same sites) so route code still
 * reads intentionally — e.g. `/reset` and agent management remain "admin only" in
 * spirit, and re-introducing multi-user later means filling these in, not finding
 * every call site.
 */
export async function requireRoomMember(_roomId: string, _userId?: string): Promise<void> {}

export async function requireRoomOwner(_roomId: string, _userId?: string): Promise<void> {}

export async function requireRoomAdmin(_roomId: string, _userId?: string): Promise<void> {}
