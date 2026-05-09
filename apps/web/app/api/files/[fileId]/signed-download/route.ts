import { ok, err } from '@/lib/api'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams { params: { fileId: string } }

interface FileRow {
  id: string
  room_id: string
  storage_path: string
  storage_bucket: string
}

export async function GET(_req: Request, { params }: RouteParams) {
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return err('Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data: fileRaw } = await supabase
    .from('files')
    .select('id, room_id, storage_path, storage_bucket')
    .eq('id', params.fileId)
    .single()
  if (!fileRaw) return err('File not found', 404)

  const file = fileRaw as FileRow
  const { data: member } = await supabase
    .from('room_members')
    .select('id')
    .eq('room_id', file.room_id)
    .eq('user_id', user.id)
    .eq('member_type', 'user')
    .single()
  if (!member) return err('Forbidden', 403)

  const { data: signedData, error: signedErr } = await supabase.storage
    .from('agentroom-files')
    .createSignedUrl(file.storage_path, 3600)
  if (signedErr || !signedData) return err(signedErr?.message ?? 'Failed to create download URL', 500)

  return ok({ signed_url: signedData.signedUrl })
}
