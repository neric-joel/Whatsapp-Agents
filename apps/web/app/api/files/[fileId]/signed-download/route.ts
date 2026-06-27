import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { filesDir, getDb, rowToFile } from '@agentroom/db'

import { apiError } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: { fileId: string }
}

export async function GET(req: Request, { params }: RouteParams) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const db = getDb()
  let fileRaw: Record<string, unknown> | undefined
  try {
    fileRaw = db.prepare('SELECT * FROM files WHERE id = ?').get(params.fileId) as
      | Record<string, unknown>
      | undefined
  } catch (e) {
    return internalError('signed-download lookup file', e)
  }
  if (!fileRaw) return apiError('NOT_FOUND', 'File not found', 404)

  const file = rowToFile(fileRaw)
  try {
    await requireRoomMember(file.room_id, user.id)
  } catch (e) {
    return e as Response
  }

  let buf: Buffer
  try {
    buf = await readFile(join(filesDir(), file.storage_path))
  } catch {
    return apiError('NOT_FOUND', 'File not found', 404)
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': file.mime_type,
      'Content-Disposition': `inline; filename="${file.filename}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
