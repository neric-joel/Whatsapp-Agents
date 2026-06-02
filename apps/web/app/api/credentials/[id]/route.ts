import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

interface RouteParams {
  params: { id: string }
}

/**
 * WS2 (ADR-0010) — delete one of the caller's own provider credentials. Owner-scoped:
 * the delete is filtered by `user_id = caller`, so a user can never delete another's
 * credential. Agents referencing it have `credential_id` set to NULL (FK ON DELETE SET
 * NULL) and fall back to host-login.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const limited = enforceRateLimit(`credential-delete:${user.id}`, 30, 60_000)
  if (limited) return limited

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('user_credentials')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id')
  if (error) return internalError('credential delete', error)
  if (!data || data.length === 0) {
    return apiError('NOT_FOUND', 'Credential not found', 404)
  }

  return apiSuccess({ id: params.id, deleted: true })
}
