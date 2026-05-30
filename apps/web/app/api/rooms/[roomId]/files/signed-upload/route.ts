import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { signedUploadSchema } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams {
  params: { roomId: string }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const supabaseUser = createSupabaseServerClient()
  const {
    data: { user },
    error: authErr,
  } = await supabaseUser.auth.getUser()
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  // Rate limit uploads per user+room (signed URLs are cheap but unbounded otherwise).
  const limited = enforceRateLimit(`upload:${user.id}:${roomId}`, 20, 60_000)
  if (limited) return limited

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomMember(supabase, roomId, user.id)
  } catch (e) {
    return e as Response
  }

  const body = await req.json().catch(() => null)
  const parseResult = signedUploadSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }
  const data = parseResult.data

  const objectPath = `rooms/${roomId}/${crypto.randomUUID()}/${data.filename}`
  const { data: signedData, error: signedErr } = await supabase.storage
    .from('agentroom-files')
    .createSignedUploadUrl(objectPath)
  if (signedErr || !signedData)
    return internalError('signed-upload createSignedUploadUrl', signedErr)

  const { data: file, error: fileErr } = await supabase
    .from('files')
    .insert({
      room_id: roomId,
      uploader_user_id: user.id,
      filename: data.filename,
      mime_type: data.mime_type,
      size_bytes: data.size_bytes,
      storage_path: objectPath,
      storage_bucket: 'agentroom-files',
      metadata: { upload_status: 'pending' },
    })
    .select('id')
    .single()
  if (fileErr || !file) return internalError('signed-upload insert file row', fileErr)

  return apiSuccess({
    signed_url: signedData.signedUrl,
    file_id: file.id,
    object_path: objectPath,
  })
}
