import { apiError } from './api-error'
import { getBearerToken } from './api-auth'

/**
 * Origins allowed to make state-changing requests. Derived from NEXT_PUBLIC_APP_URL
 * plus an optional comma-separated EXTRA_ALLOWED_ORIGINS list (for reverse proxies).
 */
export function allowedOrigins(): string[] {
  const list = new Set<string>()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) {
    try { list.add(new URL(appUrl).origin) } catch { /* ignore malformed */ }
  }
  for (const extra of (process.env.EXTRA_ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = extra.trim()
    if (!trimmed) continue
    try { list.add(new URL(trimmed).origin) } catch { /* ignore malformed */ }
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
  try { return new URL(url).origin } catch { return null }
}

/** Route-handler guard: returns a 403 response if the request is cross-origin. */
export function assertSameOrigin(req: { method: string; headers: Headers; url?: string }) {
  if (isForbiddenCrossOrigin(req)) {
    return apiError('FORBIDDEN', 'Cross-origin request rejected', 403)
  }
  return null
}

// ---------------------------------------------------------------------------
// In-memory fixed-window rate limiter.
//
// Suitable for a single web instance (the documented self-hosting topology).
// For horizontally-scaled deployments, back this with Redis/Upstash — see
// docs/SELF_HOSTING.md. State is per-process and resets on restart.
// ---------------------------------------------------------------------------

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export interface RateLimitResult { ok: boolean; retryAfterMs: number; remaining: number }

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfterMs: 0, remaining: limit - 1 }
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterMs: bucket.resetAt - now, remaining: 0 }
  }
  bucket.count += 1
  return { ok: true, retryAfterMs: 0, remaining: limit - bucket.count }
}

/** Guard helper: returns a 429 response when the limit is exceeded, else null. */
export function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const result = checkRateLimit(key, limit, windowMs)
  if (result.ok) return null
  const retryAfter = Math.ceil(result.retryAfterMs / 1000)
  return apiError('RATE_LIMITED', `Rate limit exceeded. Retry in ${retryAfter}s.`, 429, { retry_after_seconds: retryAfter })
}

/** Test-only: clear all rate-limit buckets. */
export function __resetRateLimits() { buckets.clear() }

// ---------------------------------------------------------------------------
// Error redaction: log the real error server-side, return a generic message.
// ---------------------------------------------------------------------------

export function internalError(context: string, raw: unknown) {
  const detail = raw instanceof Error ? raw.message : String(raw)
  console.error(`[api] ${context}: ${detail}`)
  return apiError('INTERNAL_ERROR', 'An internal error occurred', 500)
}
