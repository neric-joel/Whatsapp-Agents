import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ROOM_ID = '11111111-1111-4111-8111-111111111111'
const ORIGIN = 'http://localhost:3000'

const db = vi.hoisted(() => ({
  roomGet: vi.fn(),
  filesRoot: '',
}))

vi.mock('@agentroom/db', () => ({
  filesDir: () => db.filesRoot,
  newId: () => '22222222-2222-4222-8222-222222222222',
  getDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes('FROM rooms')) {
        return { get: db.roomGet }
      }
      return {
        get: vi.fn(),
        run: vi.fn(),
        all: vi.fn(),
      }
    },
  }),
}))

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: () =>
    Promise.resolve({
      data: { user: { id: 'local-user' } },
      error: null,
    }),
}))

vi.mock('@/lib/permissions', () => ({
  requireRoomMember: vi.fn(() => Promise.resolve()),
}))

import { POST } from './route'

function postUpload(filename: string, mimeType = 'image/png') {
  const form = new FormData()
  form.set('file', new File(['fake-bytes'], filename, { type: mimeType }))
  const req = new NextRequest(`${ORIGIN}/api/rooms/${ROOM_ID}/files/signed-upload`, {
    method: 'POST',
    headers: { origin: ORIGIN },
    body: form,
  })
  return POST(req, { params: Promise.resolve({ roomId: ROOM_ID }) })
}

describe('POST /api/rooms/[roomId]/files/signed-upload', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    db.roomGet.mockReturnValue({ id: ROOM_ID })
    db.filesRoot = await mkdtemp(join(tmpdir(), 'agentroom-upload-test-'))
  })

  afterEach(async () => {
    await rm(db.filesRoot, { recursive: true, force: true })
  })

  it('accepts an ordinary filename', async () => {
    const res = await postUpload('photo.png')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('rejects a filename containing CR/LF at upload, before it can ever reach disk or the DB', async () => {
    // Today this filename round-trips through req.formData() unchanged (the
    // WHATWG multipart parser decodes the %0D/%0A a real HTML form serializes
    // it as) and is stored as-is, which later makes the download route's
    // `new Response(...)` throw and permanently 500 that file's download.
    const res = await postUpload('evil\r\nfile.png')

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects a filename containing a quote at upload — the chart.png/quarterly-report.pdf.exe attack starts here', async () => {
    const res = await postUpload(`chart.png"; filename*=UTF-8''quarterly-report.pdf.exe; z="`)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('still rejects path traversal and separators (unchanged by this fix)', async () => {
    expect((await postUpload('../etc/passwd')).status).toBe(400)
    expect((await postUpload('a/b.png')).status).toBe(400)
    expect((await postUpload('..')).status).toBe(400)
  })
})
