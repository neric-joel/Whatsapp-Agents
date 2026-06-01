import { scanMemoryContent } from '@agentroom/shared'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { createMemorySchema } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams {
  params: { roomId: string }
}

const RECALL_LIMIT = 50

async function requireAuthenticatedRoomMember(roomId: string) {
  const supabaseUser = createSupabaseServerClient()
  const {
    data: { user },
    error: authErr,
  } = await supabaseUser.auth.getUser()
  if (authErr || !user) return { error: apiError('UNAUTHORIZED', 'Unauthorized', 401) }

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomMember(supabase, roomId, user.id)
  } catch (e) {
    return { error: e as Response }
  }

  return { supabase, user }
}

/**
 * GET — list/recall memory for the room. With `?q=`, runs ranked Postgres FTS
 * (the `/recall` command); without it, lists the most relevant active memory for
 * the Memory panel. Returns room-shared notes, every agent's room memory, and the
 * caller's personal global notes (membership/ownership enforced in SQL).
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(params.roomId)
  if ('error' in auth) return auth.error

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''

  const { data, error } = await auth.supabase.rpc('recall_agent_memory', {
    p_agent_id: null,
    p_room_id: params.roomId,
    p_query: q,
    p_limit: RECALL_LIMIT,
    p_user_id: auth.user.id,
  })
  if (error) return internalError('memory recall', error)

  return apiSuccess(data ?? [])
}

/**
 * POST — `/remember`. Stores a user-authored memory. Content is injection-scanned
 * + sanitized before it lands (the same scan the bridge applies to agent memory).
 * The browser never writes the table directly — this server route uses the
 * service role after an authn + membership check.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const auth = await requireAuthenticatedRoomMember(params.roomId)
  if ('error' in auth) return auth.error

  const limited = enforceRateLimit(`memory:${auth.user.id}:${params.roomId}`, 30, 60_000)
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = createMemorySchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parsed.error.flatten())
  }
  const input = parsed.data
  const scope = input.scope ?? 'room'
  const scan = scanMemoryContent(input.content)
  const title = input.title ? scanMemoryContent(input.title).sanitized.slice(0, 200) : null

  const { data, error } = await auth.supabase
    .from('agent_memory')
    .insert({
      agent_id: null,
      room_id: scope === 'room' ? params.roomId : null,
      scope,
      kind: input.kind ?? 'fact',
      title,
      content: scan.sanitized,
      created_by_user_id: auth.user.id,
      injection_flagged: scan.flagged,
    })
    .select()
    .single()
  if (error || !data) return internalError('memory create', error)

  return apiSuccess(data, 201)
}
