/** @type {import('next').NextConfig} */

// Derive connect-src from the Supabase URL so the browser can reach the API,
// realtime (wss) and storage endpoints while everything else stays same-origin.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
let supabaseOrigin = ''
let supabaseWs = ''
try {
  if (supabaseUrl) {
    const u = new URL(supabaseUrl)
    supabaseOrigin = u.origin
    supabaseWs = `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`
  }
} catch {
  // ignore malformed URL at build time
}

// Pragmatic CSP: locks framing/objects/base-uri, scopes connect-src to self +
// Supabase. script/style allow 'unsafe-inline' because the App Router emits
// inline bootstrap without nonces; tightening to nonce-based CSP is tracked as
// a follow-up (Phase 4). frame-ancestors 'none' is the key clickjacking guard.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // Scope network egress to self + Supabase (REST/storage + realtime wss). No
  // blanket `https:` so an injected script cannot exfiltrate to arbitrary hosts.
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs}`.replace(/\s+/g, ' ').trim(),
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
