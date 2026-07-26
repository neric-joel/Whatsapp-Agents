import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  fileGet: vi.fn(),
  filesRoot: '',
}))

vi.mock('@agentroom/db', () => ({
  filesDir: () => db.filesRoot,
  getDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes('FROM files')) {
        return { get: db.fileGet }
      }
      return {
        get: vi.fn(),
        run: vi.fn(),
        all: vi.fn(),
      }
    },
  }),
  rowToFile: (row: Record<string, unknown>) => row,
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

import { SAFE_INLINE_DOWNLOAD_MIME_TYPES } from '@/lib/download-disposition'

import { GET } from './route'

const baseFileRow = {
  id: 'file-1',
  room_id: 'room-1',
  uploader_user_id: 'local-user',
  filename: 'diagram.svg',
  mime_type: 'image/svg+xml',
  size_bytes: 11,
  storage_path: 'rooms/room-1/file-1/diagram.svg',
  storage_bucket: 'local',
  message_id: null,
  metadata: {},
  extracted_text: null,
  created_at: '2026-07-26T00:00:00.000Z',
  updated_at: '2026-07-26T00:00:00.000Z',
}

describe('GET /api/files/[fileId]/signed-download', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    db.filesRoot = await mkdtemp(join(tmpdir(), 'agentroom-download-test-'))
  })

  afterEach(async () => {
    await rm(db.filesRoot, { recursive: true, force: true })
  })

  it('serves SVG files as sandboxed attachments', async () => {
    await writeStoredFile('rooms/room-1/file-1/diagram.svg', '<svg></svg>')
    db.fileGet.mockReturnValue(baseFileRow)

    const res = await GET(new Request('http://localhost:3000/api/files/file-1/signed-download'), {
      params: Promise.resolve({ fileId: 'file-1' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="diagram.svg"')
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('keeps SVG out of the safe inline MIME allowlist', async () => {
    expect(SAFE_INLINE_DOWNLOAD_MIME_TYPES).toContain('image/png')
    expect(SAFE_INLINE_DOWNLOAD_MIME_TYPES).toContain('text/plain')
    expect(SAFE_INLINE_DOWNLOAD_MIME_TYPES).not.toContain('image/svg+xml')
  })
})

async function writeStoredFile(relativePath: string, contents: string) {
  const fullPath = join(db.filesRoot, relativePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, contents, { flag: 'w' })
}
