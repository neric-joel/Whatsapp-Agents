import { NextRequest } from 'next/server'

import { getDb, newId, filesDir } from '@agentroom/db'

import { getAuthenticatedUser } from '@/lib/auth'
import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: { roomId: string }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  // Rate limit uploads per user+room (uploads are cheap but unbounded otherwise).
  const limited = enforceRateLimit(`upload:${user.id}:${roomId}`, 20, 60_000)
  if (limited) return limited

  try {
    await requireRoomMember(roomId, user.id)
  } catch (e) {
    return e as Response
  }

  // Read the multipart body and validate the file before touching disk/db.
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return apiError('VALIDATION_ERROR', 'Missing file in multipart body', 400)
  }

  // Reject path separators / traversal in the supplied filename (same invariant the
  // old JSON schema enforced via signedUploadSchema.filename).
  const filename = file.name
  if (
    !filename ||
    filename.length > 255 ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    filename === '.' ||
    filename === '..'
  ) {
    return apiError(
      'VALIDATION_ERROR',
      'filename must not contain path separators or traversal sequences',
      400,
    )
  }

  const mimeType = file.type
  if (!(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return apiError('VALIDATION_ERROR', `Unsupported mime type: ${mimeType || 'unknown'}`, 400)
  }

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length === 0 || buf.length > MAX_UPLOAD_BYTES) {
    return apiError(
      'VALIDATION_ERROR',
      `File size must be between 1 and ${MAX_UPLOAD_BYTES} bytes`,
      400,
    )
  }

  const id = newId()
  const rel = `rooms/${roomId}/${id}/${filename}`

  try {
    const { join } = await import('node:path')
    const { mkdir, writeFile } = await import('node:fs/promises')
    const abs = join(filesDir(), rel)
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, buf)
  } catch (e) {
    return internalError('signed-upload write file to disk', e)
  }

  const db = getDb()
  try {
    db.prepare(
      `INSERT INTO files (id, room_id, uploader_user_id, filename, mime_type, size_bytes, storage_path, storage_bucket)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, roomId, user.id, filename, mimeType, buf.length, rel, 'local')
  } catch (e) {
    return internalError('signed-upload insert file row', e)
  }

  return apiSuccess({ file_id: id, storage_path: rel })
}
