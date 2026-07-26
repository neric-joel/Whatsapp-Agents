// ---------------------------------------------------------------------------
// Edge-safe origin / CSRF helpers.
//
// This module is deliberately free of any Node-runtime imports (no logger, no
// error-tracking) so it can be pulled into the Edge middleware bundle without
// dragging in `process.stdout`/`process.stderr`. Keep it that way: only import
// pure, Edge-compatible code here. Route handlers consume these via the
// re-export in `./api-security`.
// ---------------------------------------------------------------------------

/**
 * Origins allowed to make state-changing requests. Derived from NEXT_PUBLIC_APP_URL
 * plus an optional comma-separated EXTRA_ALLOWED_ORIGINS list (for reverse proxies).
 */
export function allowedOrigins(): string[] {
  const list = new Set<string>()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try {
      list.add(new URL(appUrl).origin)
    } catch {
      /* ignore malformed */
    }
  }
  for (const extra of (process.env.EXTRA_ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = extra.trim()
    if (!trimmed) continue
    try {
      list.add(new URL(trimmed).origin)
    } catch {
      /* ignore malformed */
    }
  }
  return [...list]
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const PINNED_SELF_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * CSRF defense for state-changing requests. This is a local single-user app with no
 * cross-site auth, so we require the Origin of any mutating request to match an
 * allowlisted origin or a pinned loopback self-origin. Returns true when the
 * request should be rejected as cross-origin.
 */
export function isForbiddenCrossOrigin(req: {
  method: string
  headers: Headers
  nextUrl?: { origin: string }
  url?: string
}): boolean {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return false

  const origin = req.headers.get('origin')
  // No Origin on a state-changing cookie request → treat as suspicious.
  if (!origin) return true

  const originUrl = safeUrl(origin)
  if (!originUrl) return true

  if (new Set(allowedOrigins()).has(originUrl.origin)) return false

  const requestUrl = safeUrl(req.nextUrl?.origin ?? req.url ?? '')
  if (!requestUrl) return true

  return !isPinnedSelfOrigin(originUrl, requestUrl)
}

function isPinnedSelfOrigin(originUrl: URL, requestUrl: URL): boolean {
  return (
    PINNED_SELF_HOSTNAMES.has(originUrl.hostname) &&
    originUrl.protocol === requestUrl.protocol &&
    originUrl.hostname === requestUrl.hostname &&
    originUrl.port === requestUrl.port
  )
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}
