import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/api'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams { params: { roomId: string } }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return err('Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data: member } = await supabase
    .from('room_members')
    .select('id')
    .eq('room_id', roomId)
    .eq('user_id', user.id)
    .eq('member_type', 'user')
    .single()
  if (!member) return err('Forbidden', 403)

  const body = await req.json().catch(() => null)
  if (
    !body ||
    typeof body.filename !== 'string' ||
    typeof body.mime_type !== 'string' ||
    typeof body.size_bytes !== 'number'
  ) {
    return err('filename, mime_type, and size_bytes are required')
  }

  const objectPath = `rooms/${roomId}/${crypto.randomUUID()}/${body.filename}`
  const { data: signedData, error: signedErr } = await supabase.storage
    .from('agentroom-files')
    .createSignedUploadUrl(objectPath)
  if (signedErr || !signedData) return err(signedErr?.message ?? 'Failed to create upload URL', 500)

  const { data: file, error: fileErr } = await supabase
    .from('files')
    .insert({
      room_id: roomId,
      uploader_user_id: user.id,
      filename: body.filename,
      mime_type: body.mime_type,
      size_bytes: body.size_bytes,
      storage_path: objectPath,
      storage_bucket: 'agentroom-files',
      metadata: { upload_status: 'pending' },
    })
    .select('id')
    .single()
  if (fileErr || !file) return err(fileErr?.message ?? 'Failed to create file row', 500)

  return ok({
    signed_url: signedData.signedUrl,
    file_id: file.id,
    object_path: objectPath,
  })
}
