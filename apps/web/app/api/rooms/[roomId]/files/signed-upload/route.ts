import { filesDir, getDb, newId } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: Promise<{ roomId: string }>
}

export async function POST(req: NextRequest, props: RouteParams) {
  const params = await props.params
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

  // roomId is the only attacker-influenced path segment below (filename is separator-checked;
  // id is server-generated). requireRoomMember is a no-op in the local app, so require a real
  // UUID that maps to an existing room BEFORE touching disk — this is the actual guard.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(roomId)) return apiError('VALIDATION_ERROR', 'Invalid room id', 400)
  const db = getDb()
  if (!db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(roomId)) {
    return apiError('NOT_FOUND', 'Room not found', 404)
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

  const { join, resolve, sep } = await import('node:path')
  const { mkdir, writeFile, unlink } = await import('node:fs/promises')
  const baseDir = resolve(filesDir())
  const abs = resolve(join(filesDir(), rel))
  // Defense-in-depth: the resolved path must stay inside the files root, even if a segment were
  // ever crafted (roomId is UUID-validated above; this guards against any future regression).
  if (abs !== baseDir && !abs.startsWith(baseDir + sep)) {
    return apiError('VALIDATION_ERROR', 'Invalid file path', 400)
  }

  try {
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, buf)
  } catch (e) {
    return internalError('signed-upload write file to disk', e)
  }

  try {
    db.prepare(
      `INSERT INTO files (id, room_id, uploader_user_id, filename, mime_type, size_bytes, storage_path, storage_bucket)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, roomId, user.id, filename, mimeType, buf.length, rel, 'local')
  } catch (e) {
    // The bytes are already on disk; remove them so a failed insert leaves no orphan file.
    await unlink(abs).catch(() => {})
    return internalError('signed-upload insert file row', e)
  }

  return apiSuccess({ file_id: id, storage_path: rel })
}
