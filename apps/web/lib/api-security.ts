import { apiError } from './api-error'
import { captureError } from './error-tracking'
import { logger } from './logger'
import { isForbiddenCrossOrigin } from './origin'

// The Edge-safe origin/CSRF helpers live in `./origin` (no logger import) so the
// middleware bundle stays logger-free. Re-exported here for route handlers that
// already import them from this module.
export { allowedOrigins, isForbiddenCrossOrigin } from './origin'

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

interface Bucket {
  count: number
  resetAt: number
}
const buckets = new Map<string, Bucket>()

interface RateLimitResult {
  ok: boolean
  retryAfterMs: number
  remaining: number
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
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
  return apiError('RATE_LIMITED', `Rate limit exceeded. Retry in ${retryAfter}s.`, 429, {
    retry_after_seconds: retryAfter,
  })
}

/** Test-only: clear all rate-limit buckets. */
export function __resetRateLimits() {
  buckets.clear()
}

// ---------------------------------------------------------------------------
// Error redaction: log the real error server-side, return a generic message.
// ---------------------------------------------------------------------------

export function internalError(context: string, raw: unknown, fields?: Record<string, unknown>) {
  const detail = raw instanceof Error ? raw.message : String(raw)
  // The logger redacts secrets/PII in field values; the client still gets a generic message.
  logger.error('api.internal_error', { context, detail, ...fields })
  // Forward to opt-in error tracking (no-op unless a DSN is configured).
  captureError(raw, { context, ...fields })
  return apiError('INTERNAL_ERROR', 'An internal error occurred', 500)
}
