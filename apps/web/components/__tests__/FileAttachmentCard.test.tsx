// @vitest-environment jsdom
//
// The repo's ONLY DOM-level component test, and it exists because two consecutive
// review rounds shipped a FileAttachmentCard whose Preview/Download button silently
// did nothing, and nothing in the suite could see it:
//
//   1. `openFile()` called `res.json()` on `/api/files/[fileId]/signed-download`, which
//      answers 200 with RAW BYTES. Every click threw a SyntaxError out of a
//      try/finally with no catch — an unhandled rejection, so: click, nothing happens.
//   2. The fix for the object-URL leak used `useRef(true)` + a cleanup setting it
//      `false`, with no reset in the effect body. React StrictMode's dev-only
//      double-invoke (mount → cleanup → mount) left `mountedRef.current === false`
//      before the user could click, so every Preview revoked the URL instead of
//      showing it. Same "nothing happens", different cause.
//
// Both are invisible to a logic-only test: they need a real render, under StrictMode,
// with a real click, against the real route's real response. That is this file.
//
// Environment notes (each of these is a trap that silently weakens the test):
//   - `environment: 'node'` is the suite-wide default and the other 224 tests need it;
//     this file opts into a DOM with the per-file docblock pragma above, not by
//     changing vitest.config.ts.
//   - StrictMode only double-invokes in React's DEVELOPMENT build. `strictModeProbe`
//     below asserts the double-invoke actually happened, so a production build (which
//     would make bug #2 untestable) fails the suite instead of quietly passing it.
//   - jsdom's `window.open` returns undefined and logs "Not implemented", which takes
//     the component's pop-up-blocked branch. It is stubbed so Download is genuinely
//     exercised, and un-stubbed to null in the one test that wants that branch.
//   - `URL.createObjectURL`/`revokeObjectURL` do resolve in this environment (Node's,
//     via `blob:nodedata:`), but they are opaque: you cannot see whether a URL leaked.
//     They are replaced with observable fakes so the object-URL lifecycle is assertable.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { act, StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  fileGet: vi.fn(),
  filesRoot: '',
}))

// Same mocking approach as lib/__tests__/file-attachment-open.test.ts: mock only the
// route's infrastructure edges so the REAL `GET` handler can run in-process. Nothing
// here hand-authors a response body or header — the shape a guessed `{ ok, data }`
// stub would have gotten wrong is exactly what caused bug #1.
vi.mock('@agentroom/db', () => ({
  filesDir: () => db.filesRoot,
  getDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes('FROM files')) {
        return { get: db.fileGet }
      }
      return { get: vi.fn(), run: vi.fn(), all: vi.fn() }
    },
  }),
  rowToFile: (row: Record<string, unknown>) => row,
}))

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: () =>
    Promise.resolve({ data: { user: { id: 'local-user' } }, error: null }),
}))

vi.mock('@/lib/permissions', () => ({
  requireRoomMember: vi.fn(() => Promise.resolve()),
}))

import { GET } from '@/app/api/files/[fileId]/signed-download/route'
import FileAttachmentCard from '@/components/FileAttachmentCard'
import { ToastProvider } from '@/contexts/ToastContext'

interface FileProp {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
}

const PNG: FileProp = {
  id: 'file-png',
  filename: 'photo.png',
  mime_type: 'image/png',
  size_bytes: 14,
}

const PDF: FileProp = {
  id: 'file-pdf',
  filename: 'report.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2048,
}

const baseRow = {
  room_id: 'room-1',
  uploader_user_id: 'local-user',
  storage_bucket: 'local',
  message_id: null,
  metadata: {},
  extracted_text: null,
  created_at: '2026-07-26T00:00:00.000Z',
  updated_at: '2026-07-26T00:00:00.000Z',
}

const pngRow = { ...baseRow, ...PNG, storage_path: 'rooms/room-1/file-png/photo.png' }
const pdfRow = { ...baseRow, ...PDF, storage_path: 'rooms/room-1/file-pdf/report.pdf' }

// ---------------------------------------------------------------------------
// Environment doubles
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>
let openMock: ReturnType<typeof vi.fn>
let createObjectURLMock: ReturnType<typeof vi.fn>
let revokeObjectURLMock: ReturnType<typeof vi.fn>
let objectUrlSeq = 0
let revokedUrls: string[] = []
let consoleErrorArgs: unknown[][] = []
let strictModeEffectMounts = 0

/** Set while a test wants the in-flight fetch held open (unmount-during-fetch). */
let fetchGate: Promise<void> | null = null

// React's `act` reads this off the global. Saved and restored rather than left set, so
// this file cannot change how a later file in the same worker behaves.
const actEnvironmentHost = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
let priorActEnvironment: boolean | undefined

/**
 * Routes the component's `fetch` to the REAL signed-download `GET` handler, so the
 * `Response` it sees is the route's actual output: raw bytes, real `Content-Type`,
 * real `Content-Disposition`. This is the contract half of the test — swap in a
 * hand-written JSON envelope here and the suite stops being able to see bug #1.
 */
function stubFetchToRealRoute() {
  fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString()
    const fileId = /\/api\/files\/([^/]+)\/signed-download/.exec(url)?.[1] ?? ''
    const res = await GET(new Request(`http://localhost${url.replace(/^https?:\/\/[^/]+/, '')}`), {
      params: Promise.resolve({ fileId }),
    })
    if (fetchGate) await fetchGate
    return res
  })
  vi.stubGlobal('fetch', fetchMock)
}

const savedUrlStatics: Record<string, PropertyDescriptor | undefined> = {}

function stubObjectUrls() {
  savedUrlStatics.create = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  savedUrlStatics.revoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  createObjectURLMock = vi.fn(() => `blob:agentroom-test/${++objectUrlSeq}`)
  revokeObjectURLMock = vi.fn((url: string) => {
    revokedUrls.push(url)
  })
  URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURLMock as unknown as typeof URL.revokeObjectURL
}

function restoreObjectUrls() {
  for (const [key, name] of [
    ['create', 'createObjectURL'],
    ['revoke', 'revokeObjectURL'],
  ] as const) {
    const saved = savedUrlStatics[key]
    if (saved) Object.defineProperty(URL, name, saved)
    else Reflect.deleteProperty(URL, name)
  }
}

// ---------------------------------------------------------------------------
// Render harness (react-dom/client + act, no testing-library)
// ---------------------------------------------------------------------------

/**
 * Rendered inside the same StrictMode tree as the card. Its mount count is the proof
 * that StrictMode's dev-only double-invoke is really happening in this run — the
 * precondition without which the bug-#2 regression test proves nothing.
 */
function StrictModeProbe() {
  useEffect(() => {
    strictModeEffectMounts += 1
  }, [])
  return null
}

interface Harness {
  container: HTMLElement
  unmount: () => Promise<void>
}

/**
 * Every root rendered by the current test, so `afterEach` can tear down the ones a
 * FAILING test never reached the end of. Without this, one failure leaks a live
 * ToastProvider (and its pending dismiss timers) into every later test in the file,
 * turning a single red test into a cascade that hides its own cause.
 */
const liveRoots: Array<() => Promise<void>> = []

async function renderCard(file: FileProp): Promise<Harness> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <StrictMode>
        <ToastProvider>
          <StrictModeProbe />
          <FileAttachmentCard file={file} />
        </ToastProvider>
      </StrictMode>,
    )
  })
  let torndown = false
  const unmount = async () => {
    if (torndown) return
    torndown = true
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
  liveRoots.push(unmount)
  return { container, unmount }
}

/** The card's own Preview/Download button (the toast viewport has buttons too). */
function actionButton(container: HTMLElement): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === 'Preview' || b.textContent === 'Download',
  )
  if (!found) throw new Error('FileAttachmentCard action button not found')
  return found
}

async function click(el: HTMLElement) {
  await act(async () => {
    clickSync(el)
  })
}

/**
 * Dispatches the click WITHOUT wrapping it in `act`, so the statement after the call
 * observes only what the handler did synchronously, inside the click's own task.
 *
 * That distinction is the whole point for Download: `window.open` keeps the click's
 * transient activation only if it runs before the handler yields, and an earlier
 * version of this component put a pre-flight `fetch` in front of it, which made Safari
 * and Firefox treat every download as a blocked pop-up. Asserting after `await
 * act(...)` cannot see that — by then any number of microtasks have drained, so an
 * `await` inserted ahead of `window.open` would still pass.
 *
 * Only safe where the synchronous part of the handler performs no state update (React
 * would warn "not wrapped in act", which afterEach turns into a failure). That is true
 * of the Download success path and nowhere else here — the pop-up-blocked branch calls
 * showToast synchronously, so it keeps the act-wrapped `click` above.
 */
function clickSync(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

/**
 * Drains real (not faked) timers and microtasks inside `act` until `predicate` holds.
 * The click handler is fired-and-forgotten (`onClick={() => void openFile()}`) and the
 * route reads from disk, so a single `act` flush is not enough — and polling outside
 * `act` is what produces "not wrapped in act" warnings, which afterEach below treats
 * as a failure rather than suppressing.
 */
async function waitFor(predicate: () => boolean, description: string, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  }
}

async function writeStoredFile(relativePath: string, contents: string) {
  const fullPath = join(db.filesRoot, relativePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, contents, { flag: 'w' })
}

// ---------------------------------------------------------------------------

describe('FileAttachmentCard (DOM, StrictMode, real signed-download route)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    priorActEnvironment = actEnvironmentHost.IS_REACT_ACT_ENVIRONMENT
    actEnvironmentHost.IS_REACT_ACT_ENVIRONMENT = true
    db.filesRoot = await mkdtemp(join(tmpdir(), 'agentroom-file-attachment-card-'))
    objectUrlSeq = 0
    revokedUrls = []
    consoleErrorArgs = []
    strictModeEffectMounts = 0
    fetchGate = null
    stubFetchToRealRoute()
    stubObjectUrls()
    // jsdom's window.open returns undefined (and logs "Not implemented"), which would
    // send every Download down the pop-up-blocked branch and make that path untested.
    openMock = vi.fn(() => ({}) as Window)
    vi.spyOn(window, 'open').mockImplementation(openMock as unknown as typeof window.open)
    // Captured rather than silenced: the component logs `openFile failed` here on
    // purpose, and React's act warnings arrive on this channel too — afterEach fails
    // the test on those instead of letting a mis-wrapped update pass unnoticed.
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrorArgs.push(args)
    })
  })

  afterEach(async () => {
    // Before the stubs come down: a failing test can leave a root mounted, and its
    // unmount still needs the object-URL fakes and a working act environment.
    for (const unmount of liveRoots.splice(0)) await unmount()

    const actWarnings = consoleErrorArgs.filter((args) =>
      String(args[0] ?? '').includes('not wrapped in act'),
    )
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    restoreObjectUrls()
    if (priorActEnvironment === undefined) {
      Reflect.deleteProperty(actEnvironmentHost, 'IS_REACT_ACT_ENVIRONMENT')
    } else {
      actEnvironmentHost.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment
    }
    document.body.innerHTML = ''
    await rm(db.filesRoot, { recursive: true, force: true })
    expect(actWarnings, 'React act() warnings must be fixed, not tolerated').toEqual([])
  })

  it('really is running React in development, so StrictMode double-invokes effects', async () => {
    // Guard on the guard. If a production React build ever gets resolved here,
    // mount → cleanup → mount stops happening and every StrictMode assertion below
    // becomes vacuously true. Fail loudly instead.
    db.fileGet.mockReturnValue(pngRow)
    await renderCard(PNG)

    expect(strictModeEffectMounts).toBe(2)
  })

  it('Preview renders the image from the real route’s raw bytes — after a StrictMode remount', async () => {
    // The regression test for BOTH shipped bugs.
    //   bug #1 (`res.json()` on a raw-bytes 200): the fetch rejects, the catch fires,
    //          an error toast appears and no <img> ever does.
    //   bug #2 (mountedRef never reset in the effect body): StrictMode's cleanup has
    //          already set it false before this click, so the resolved URL is revoked
    //          instead of displayed — `revokedUrls` is non-empty and no <img> appears.
    await writeStoredFile('rooms/room-1/file-png/photo.png', 'fake-png-bytes')
    db.fileGet.mockReturnValue(pngRow)

    const view = await renderCard(PNG)
    const button = actionButton(view.container)
    expect(button.textContent).toBe('Preview')

    await click(button)
    await waitFor(
      () =>
        view.container.querySelector('img') !== null ||
        view.container.querySelector('[role="alert"]') !== null ||
        revokedUrls.length > 0,
      'Preview to show the image (or fail visibly)',
    )

    // Ordered so each broken version reports its own cause rather than a generic
    // "img was null".
    expect(revokedUrls, 'a still-displayed preview URL must not be revoked').toEqual([])
    expect(view.container.querySelector('[role="alert"]')?.textContent ?? null).toBeNull()

    const img = view.container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('blob:agentroom-test/1')
    expect(img?.getAttribute('alt')).toBe('photo.png')

    // The ARGUMENT, not just the call count. `URL.createObjectURL(res)` instead of
    // `URL.createObjectURL(await res.blob())` still mints exactly one URL and still
    // renders an <img>, so a count-only assertion passes against it. The 14 bytes are
    // the stored file's, which is also what PNG.size_bytes claims — so this pins that
    // the blob really carries the route's body rather than a wrapper around it.
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    const blobArg = createObjectURLMock.mock.calls[0]?.[0]
    expect(blobArg).toBeInstanceOf(Blob)
    expect((blobArg as Blob).size).toBe(PNG.size_bytes)

    expect(button.disabled).toBe(false)
    expect(consoleErrorArgs).toEqual([])
  })

  it('revokes the preview object URL when the card unmounts', async () => {
    await writeStoredFile('rooms/room-1/file-png/photo.png', 'fake-png-bytes')
    db.fileGet.mockReturnValue(pngRow)

    const view = await renderCard(PNG)
    await click(actionButton(view.container))
    await waitFor(() => view.container.querySelector('img') !== null, 'the preview <img>')
    expect(revokedUrls).toEqual([])

    await view.unmount()

    expect(revokedUrls).toEqual(['blob:agentroom-test/1'])
  })

  it('revokes — rather than leaks — an object URL that resolves after the card unmounted', async () => {
    // This is the leak `mountedRef` exists to close: setImgUrl would be a no-op on an
    // unmounted card, so the URL would never reach the revoke-on-change effect.
    await writeStoredFile('rooms/room-1/file-png/photo.png', 'fake-png-bytes')
    db.fileGet.mockReturnValue(pngRow)

    let release!: () => void
    fetchGate = new Promise<void>((resolve) => {
      release = resolve
    })

    const view = await renderCard(PNG)
    await click(actionButton(view.container))
    expect(createObjectURLMock).not.toHaveBeenCalled()

    await view.unmount()
    fetchGate = null
    release()

    await waitFor(() => revokedUrls.length > 0, 'the late object URL to be revoked')
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    expect(revokedUrls).toEqual(['blob:agentroom-test/1'])
    // Deliberately NOT `expect(querySelector('img')).toBeNull()` — unmount() detaches
    // the container, so that passes no matter what the component did. The real claim
    // is that the late resolve is silent: revoked once, no second revoke, no error.
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1)
    expect(consoleErrorArgs).toEqual([])
  })

  it('Download hands the signed-download URL straight to window.open and never fetches it', async () => {
    db.fileGet.mockReturnValue(pdfRow)

    const view = await renderCard(PDF)
    const button = actionButton(view.container)
    expect(button.textContent).toBe('Download')

    // NOT `await click(...)`. These two assertions run in the same task as the dispatch,
    // with nothing awaited in between, which is the only way to enforce "window.open
    // runs before the handler yields". Wrapped in `act`, an `await Promise.resolve()`
    // inserted ahead of window.open would still pass.
    clickSync(button)
    expect(openMock).toHaveBeenCalledTimes(1)
    expect(openMock).toHaveBeenCalledWith(
      '/api/files/file-pdf/signed-download',
      '_blank',
      'noopener,noreferrer',
    )

    // Now let anything the handler queued settle, and confirm it queued nothing: the
    // historical fault was a pre-flight fetch sitting between the click and this call.
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createObjectURLMock).not.toHaveBeenCalled()
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
    expect(consoleErrorArgs).toEqual([])
  })

  it('reports a blocked pop-up through the real ToastProvider instead of failing silently', async () => {
    openMock.mockReturnValue(null as unknown as Window)
    db.fileGet.mockReturnValue(pdfRow)

    const view = await renderCard(PDF)
    await click(actionButton(view.container))

    await waitFor(
      () => view.container.querySelector('[role="alert"]') !== null,
      'the pop-up-blocked toast',
    )
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't open report.pdf.",
    )
    expect(consoleErrorArgs[0]?.[0]).toBe('openFile failed')
  })

  it('reports a failed Preview through the real ToastProvider when the route answers 404', async () => {
    // The route 404s on an unknown id. Before the fix this whole path was an unhandled
    // rejection: no toast, no log, no <img> — indistinguishable from a dead button.
    db.fileGet.mockReturnValue(undefined)

    const view = await renderCard(PNG)
    const button = actionButton(view.container)
    await click(button)

    await waitFor(
      () => view.container.querySelector('[role="alert"]') !== null,
      'the preview-failed toast',
    )
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't open photo.png.",
    )
    expect(view.container.querySelector('img')).toBeNull()
    expect(createObjectURLMock).not.toHaveBeenCalled()
    expect(consoleErrorArgs[0]?.[0]).toBe('openFile failed')
    expect(button.disabled).toBe(false)
  })
})
