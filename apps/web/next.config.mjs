/** @type {import('next').NextConfig} */

// Pragmatic CSP for a LOCAL single-user app. Everything is same-origin now (no
// Supabase REST/realtime/storage), so connect-src is just 'self'. script/style
// allow 'unsafe-inline' because the App Router emits inline bootstrap without
// nonces; frame-ancestors 'none' is the key clickjacking guard.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // No external egress: a local app talks only to its own origin.
  "connect-src 'self'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig = {
  // Emit a self-contained server (.next/standalone) for a small production image.
  output: 'standalone',
  // @agentroom/shared and @agentroom/db ship raw TypeScript (no build step), so
  // transpile them explicitly — this makes the production build deterministic.
  transpilePackages: ['@agentroom/shared', '@agentroom/db'],
  // @agentroom/* are ESM/NodeNext and use explicit `.js` import specifiers
  // (e.g. `export * from './redact.js'`). webpack does not rewrite `.js`→`.ts` on
  // its own, so map the extensions like tsx/Node ESM do.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    }
    return config
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Enable the instrumentation.ts hook (stable in Next 15; opt-in in 14.2).
    instrumentationHook: true,
    // better-sqlite3 is a native module — keep it external so Next doesn't try to
    // bundle the .node binary into the server build.
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
