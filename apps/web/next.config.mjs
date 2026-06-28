/** @type {import('next').NextConfig} */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// @vercel/nft statically evaluates os.homedir() during the build trace and scandir's the result.
// On Windows that hits the ACL-protected `Application Data` junction in the real user profile and
// fails the build with EPERM (CI = Linux never sees it). Point THIS build process's home env at an
// empty throwaway dir so the trace scans a safe folder instead. next.config.mjs is loaded only by
// `next build` (this process); `next start` runs in a separate process, so the app's runtime
// home/app-data resolution (~/.agentroom) is unchanged. This replaces the Next-14-era
// `outputFileTracing: false` workaround and is version-agnostic — it survives the removal of that
// option in Next 16 and works whether or not the trace runs.
const buildTraceHome = path.join(os.tmpdir(), 'agentroom-build-trace-home')
fs.mkdirSync(buildTraceHome, { recursive: true })
process.env.HOME = buildTraceHome
process.env.USERPROFILE = buildTraceHome

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
  // @agentroom/shared and @agentroom/db ship raw TypeScript (no build step), so transpile them
  // explicitly — this makes the production build deterministic.
  transpilePackages: ['@agentroom/shared', '@agentroom/db'],
  // better-sqlite3 is a native module — keep it (and its `bindings` loader) external on the server
  // so Next requires it from node_modules at runtime instead of bundling the .node binary.
  // (Renamed from experimental.serverComponentsExternalPackages in Next 15.)
  serverExternalPackages: ['better-sqlite3', 'bindings'],
  // @agentroom/* are ESM/NodeNext and use explicit `.js` import specifiers (e.g. `export *
  // from './redact.js'`). webpack does not rewrite `.js`→`.ts`, so map the extensions like
  // tsx/Node ESM. Turbopack cannot express extensionAlias (vercel/next.js#82945), so the build is
  // pinned to webpack (see the web `build` script). The explicit server-externals push below is
  // kept as the load-bearing externalizer: serverExternalPackages alone is defeated when
  // better-sqlite3 is reached THROUGH the transpiled @agentroom/db package.
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    }
    if (isServer) {
      config.externals = [...(config.externals ?? []), 'better-sqlite3', 'bindings']
    }
    return config
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Types are enforced by the separate `pnpm typecheck` gate (which passes). Next's in-build
    // type-check runs in a worker with a small heap and OOMs on this machine, so skip it here.
    ignoreBuildErrors: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
