import { getBearerToken } from './api-auth'

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

/**
 * CSRF defense for cookie-authenticated mutations. A browser cannot set a custom
 * Authorization header cross-site, so Bearer-authenticated requests are exempt.
 * For cookie auth we require the Origin to match the request host or an allowlisted
 * origin. Returns true when the request should be rejected as cross-origin.
 */
export function isForbiddenCrossOrigin(req: {
  method: string
  headers: Headers
  nextUrl?: { origin: string }
  url?: string
}): boolean {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return false

  // Bearer-authed (programmatic) clients are not subject to CSRF.
  if (getBearerToken(req)) return false

  const origin = req.headers.get('origin')
  // No Origin on a state-changing cookie request → treat as suspicious.
  if (!origin) return true

  const selfOrigin = req.nextUrl?.origin ?? (req.url ? safeOrigin(req.url) : null)
  const allowed = new Set(allowedOrigins())
  if (selfOrigin) allowed.add(selfOrigin)

  return !allowed.has(origin)
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}
