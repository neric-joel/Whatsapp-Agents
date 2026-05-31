import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { updateMemorySchema } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams {
  params: { memoryId: string }
}

/**
 * PATCH — pin / forget (set `is_active` / `pinned`) a memory entry. Allowed for a
 * member of the memory's room, or the owner of a personal global note. Writes go
 * through the service role after the authz check.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const supabaseUser = createSupabaseServerClient()
  const {
    data: { user },
    error: authErr,
  } = await supabaseUser.auth.getUser()
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const limited = enforceRateLimit(`memory-patch:${user.id}`, 60, 60_000)
  if (limited) return limited

  const supabase = createSupabaseServiceClient()
  const { data: mem } = await supabase
    .from('agent_memory')
    .select('id, room_id, created_by_user_id')
    .eq('id', params.memoryId)
    .single()
  if (!mem) return apiError('NOT_FOUND', 'Memory not found', 404)

  const row = mem as { id: string; room_id: string | null; created_by_user_id: string | null }
  if (row.room_id) {
    try {
      await requireRoomMember(supabase, row.room_id, user.id)
    } catch (e) {
      return e as Response
    }
  } else if (row.created_by_user_id !== user.id) {
    return apiError('FORBIDDEN', 'Not allowed to modify this memory', 403)
  }

  const body = await req.json().catch(() => null)
  const parsed = updateMemorySchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parsed.error.flatten())
  }

  const { data, error } = await supabase
    .from('agent_memory')
    .update(parsed.data)
    .eq('id', params.memoryId)
    .select()
    .single()
  if (error || !data) return internalError('memory update', error)

  return apiSuccess(data)
}
