import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { requireRoomAdmin } from '@/lib/permissions'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

interface RouteParams {
  params: { roomId: string }
}

/**
 * Phase 11 `/reset` (admin+). Clears the room's rolling agent context by
 * stamping `context_reset_at` — the bridge then only feeds agents messages
 * created at/after this moment. Messages are NOT deleted; the transcript stays
 * intact and the action is reversible. RBAC is enforced here, server-side, so a
 * plain `member` cannot reset even if the command were not hidden in the UI.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params

  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const limited = enforceRateLimit(`reset:${user.id}:${roomId}`, 10, 60_000)
  if (limited) return limited

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomAdmin(supabase, roomId, user.id)
  } catch (e) {
    return e as Response
  }

  const now = new Date().toISOString()
  const { error: updErr } = await supabase
    .from('rooms')
    .update({ context_reset_at: now })
    .eq('id', roomId)
  if (updErr) return internalError('room context reset', updErr)

  await supabase.from('messages').insert({
    room_id: roomId,
    sender_type: 'system',
    content: 'Agent context was reset by an admin. Agents start fresh from here.',
    content_type: 'text',
    mentions: [],
    target_agent_ids: [],
    round_index: 0,
  })

  return apiSuccess({ context_reset_at: now })
}
