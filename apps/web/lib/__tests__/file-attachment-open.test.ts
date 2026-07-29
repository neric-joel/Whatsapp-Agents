import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  fileGet: vi.fn(),
  filesRoot: '',
}))

// Same mocking approach as
// app/api/files/[fileId]/signed-download/route.test.ts — this suite imports and
// invokes that SAME real `GET` handler (not a hand-rolled stand-in for it), so the
// Response objects `fetch()` hands back below are the route's actual output.
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

import { GET } from '@/app/api/files/[fileId]/signed-download/route'

import { canPreviewInline, resolvePreviewImageUrl } from '../file-attachment-open'

const baseFileRow = {
  id: 'file-1',
  room_id: 'room-1',
  uploader_user_id: 'local-user',
  filename: 'photo.png',
  mime_type: 'image/png',
  size_bytes: 4,
  storage_path: 'rooms/room-1/file-1/photo.png',
  storage_bucket: 'local',
  message_id: null,
  metadata: {},
  extracted_text: null,
  created_at: '2026-07-26T00:00:00.000Z',
  updated_at: '2026-07-26T00:00:00.000Z',
}

/**
 * Routes `fetch()` calls made by the module under test to the real signed-download
 * `GET` handler. This is what makes the suite a CONTRACT test rather than a
 * structure-only one: `resolvePreviewImageUrl` sees the actual Response the route
 * produces (raw bytes + real headers), the same one a browser would get — never a
 * `{ ok, data: { signed_url } }` shape someone assumed it had.
 */
function stubFetchToRealRoute() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString()
      const fileId = /\/api\/files\/([^/]+)\/signed-download/.exec(url)?.[1] ?? ''
      return GET(new Request(`http://localhost${url.replace(/^https?:\/\/[^/]+/, '')}`), {
        params: Promise.resolve({ fileId }),
      })
    }),
  )
}

describe('file-attachment-open (contract with the real signed-download route)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    db.filesRoot = await mkdtemp(join(tmpdir(), 'agentroom-file-attachment-open-'))
    stubFetchToRealRoute()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(db.filesRoot, { recursive: true, force: true })
  })

  it("pins the actual bug: the real route's success response cannot be parsed as JSON", async () => {
    // This is the exact failure FileAttachmentCard hit: its old `fetchSignedUrl`
    // helper did `await res.json()` unconditionally. The route answers 200 with raw
    // bytes, so that threw a SyntaxError on every successful click. Demonstrated here
    // against the real `GET` handler, not a guess about what it returns.
    await writeStoredFile('rooms/room-1/file-1/photo.png', 'fake-png-bytes')
    db.fileGet.mockReturnValue(baseFileRow)

    const res = await GET(new Request('http://localhost/api/files/file-1/signed-download'), {
      params: Promise.resolve({ fileId: 'file-1' }),
    })

    expect(res.ok).toBe(true)
    await expect(res.clone().json()).rejects.toThrow()
  })

  it('resolvePreviewImageUrl resolves a usable object URL from the real raw-bytes response', async () => {
    await writeStoredFile('rooms/room-1/file-1/photo.png', 'fake-png-bytes')
    db.fileGet.mockReturnValue(baseFileRow)

    const url = await resolvePreviewImageUrl('file-1')

    expect(url).toMatch(/^blob:/)
    URL.revokeObjectURL(url)
  })

  it('resolvePreviewImageUrl rejects when the real route answers not-found', async () => {
    db.fileGet.mockReturnValue(undefined)

    await expect(resolvePreviewImageUrl('missing-file')).rejects.toThrow()
  })

  // REGRESSION: an image/svg+xml attachment must never reach the blob-preview path.
  // SVG is allowed at upload (isValidUploadMimeType) but excluded from inline serving
  // (SAFE_INLINE_DOWNLOAD_MIME_TYPES), because the route's answer for it is an
  // attachment under `Content-Security-Policy: default-src 'none'; sandbox`. A blob:
  // URL made from the same bytes is a same-origin document with NO CSP, one
  // right-click ("Open image in new tab") away from executing the SVG's script
  // against this app's origin. The old gate was `mime_type.startsWith('image/')`,
  // which includes SVG — this test fails against that code, because the object URL
  // was minted successfully.
  it('never mints a blob: URL for an image/svg+xml attachment — the type the route refuses to serve inline', async () => {
    await writeStoredFile(
      'rooms/room-1/file-1/diagram.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/connections")</script></svg>',
    )
    db.fileGet.mockReturnValue({
      ...baseFileRow,
      filename: 'diagram.svg',
      mime_type: 'image/svg+xml',
      storage_path: 'rooms/room-1/file-1/diagram.svg',
    })
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')

    // The decision the card renders from, and the enforcement point that mints the URL,
    // must agree — otherwise the button says one thing and does the other.
    expect(canPreviewInline('image/svg+xml')).toBe(false)
    await expect(resolvePreviewImageUrl('file-1')).rejects.toThrow(/not previewable/)
    expect(createObjectURL).not.toHaveBeenCalled()

    createObjectURL.mockRestore()
  })

  it('the Preview gate is the signed-download inline allowlist, not "starts with image/"', () => {
    // Safe to render inline AND renderable in an <img>.
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'IMAGE/PNG']) {
      expect(canPreviewInline(type)).toBe(true)
    }
    // On the inline allowlist but not an image — <img> cannot show it, so Download.
    expect(canPreviewInline('text/plain')).toBe(false)
    // `image/*` but NOT on the inline allowlist — the whole point of this fix.
    for (const type of ['image/svg+xml', 'image/svg+xml; charset=utf-8', 'image/bmp']) {
      expect(canPreviewInline(type)).toBe(false)
    }
    expect(canPreviewInline(null)).toBe(false)
    expect(canPreviewInline(undefined)).toBe(false)
    expect(canPreviewInline('')).toBe(false)
  })
})

async function writeStoredFile(relativePath: string, contents: string) {
  const fullPath = join(db.filesRoot, relativePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, contents, { flag: 'w' })
}
