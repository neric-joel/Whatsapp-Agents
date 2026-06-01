import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams {
  params: { fileId: string }
}

interface FileRow {
  id: string
  room_id: string
  storage_path: string
  storage_bucket: string
}

export async function GET(_req: Request, { params }: RouteParams) {
  const supabaseUser = createSupabaseServerClient()
  const {
    data: { user },
    error: authErr,
  } = await supabaseUser.auth.getUser()
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data: fileRaw } = await supabase
    .from('files')
    .select('id, room_id, storage_path, storage_bucket')
    .eq('id', params.fileId)
    .single()
  if (!fileRaw) return apiError('NOT_FOUND', 'File not found', 404)

  const file = fileRaw as FileRow
  try {
    await requireRoomMember(supabase, file.room_id, user.id)
  } catch (e) {
    return e as Response
  }

  const { data: signedData, error: signedErr } = await supabase.storage
    .from('agentroom-files')
    .createSignedUrl(file.storage_path, 3600)
  if (signedErr || !signedData) return internalError('signed-download create url', signedErr)

  return apiSuccess({ signed_url: signedData.signedUrl })
}
