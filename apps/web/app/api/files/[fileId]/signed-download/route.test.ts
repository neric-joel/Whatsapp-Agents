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

import { splitDispositionParams } from '@/lib/__tests__/disposition-params'
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
    expect(res.headers.get('Content-Disposition')).toBe(
      `attachment; filename="diagram.svg"; filename*=UTF-8''diagram.svg`,
    )
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('keeps SVG out of the safe inline MIME allowlist', async () => {
    expect(SAFE_INLINE_DOWNLOAD_MIME_TYPES).toContain('image/png')
    expect(SAFE_INLINE_DOWNLOAD_MIME_TYPES).toContain('text/plain')
    expect(SAFE_INLINE_DOWNLOAD_MIME_TYPES).not.toContain('image/svg+xml')
  })

  it('still serves an allowlisted inline MIME type inline, unaffected by the disposition-header fix', async () => {
    await writeStoredFile('rooms/room-1/file-2/photo.png', 'binary-ish')
    db.fileGet.mockReturnValue({
      ...baseFileRow,
      id: 'file-2',
      filename: 'photo.png',
      mime_type: 'image/png',
      storage_path: 'rooms/room-1/file-2/photo.png',
    })

    const res = await GET(new Request('http://localhost:3000/api/files/file-2/signed-download'), {
      params: Promise.resolve({ fileId: 'file-2' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toBe(
      `inline; filename="photo.png"; filename*=UTF-8''photo.png`,
    )
  })

  it('does not let a stored filename with a quote smuggle a second, attacker-controlled filename* — chart.png saved to disk as quarterly-report.pdf.exe', async () => {
    // The concrete attack from the brief: a real PNG named so that its stored
    // `filename` closes the quoted `filename=` parameter early and appends a
    // `filename*` that a browser would prefer, saving the download under a
    // completely different, attacker-chosen name.
    const poisonedName = `chart.png"; filename*=UTF-8''quarterly-report.pdf.exe; z="`
    await writeStoredFile('rooms/room-1/file-3/chart.png', 'fake-png-bytes')
    db.fileGet.mockReturnValue({
      ...baseFileRow,
      id: 'file-3',
      filename: poisonedName,
      mime_type: 'image/png',
      storage_path: 'rooms/room-1/file-3/chart.png',
    })

    const res = await GET(new Request('http://localhost:3000/api/files/file-3/signed-download'), {
      params: Promise.resolve({ fileId: 'file-3' }),
    })

    expect(res.status).toBe(200)
    const disposition = res.headers.get('Content-Disposition') ?? ''
    const params = splitDispositionParams(disposition)
    const starParams = params.filter((p) => p.startsWith("filename*=UTF-8''"))
    // Exactly one real filename* parameter — the DB row's poisoned filename does
    // land in the header text, but only inertly, inside the quoted fallback.
    expect(starParams).toHaveLength(1)
    // And that one real parameter is the fully encoded original string, never
    // the raw attacker-chosen filename the row tried to smuggle in. `'` and `*`
    // in the payload are RFC 5987 ext-value-significant, so the real encoder
    // escapes them too, on top of encodeURIComponent.
    const expectedStar = encodeURIComponent(poisonedName).replace(
      /['()*!]/g,
      (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
    )
    expect(starParams[0]).toBe(`filename*=UTF-8''${expectedStar}`)
    expect(starParams[0]).not.toBe("filename*=UTF-8''quarterly-report.pdf.exe")
  })
})

async function writeStoredFile(relativePath: string, contents: string) {
  const fullPath = join(db.filesRoot, relativePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, contents, { flag: 'w' })
}
