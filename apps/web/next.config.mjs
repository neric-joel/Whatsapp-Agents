/** @type {import('next').NextConfig} */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  typescript: {
    // Types are enforced by the separate `pnpm typecheck` gate (which passes). Next's in-build
    // type-check runs in a worker with a small heap and OOMs on this machine, so skip it here.
    ignoreBuildErrors: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

// Exported as a phase function so the @vercel/nft Windows-EPERM workaround runs ONLY during the
// production build, never at runtime. @vercel/nft statically evaluates os.homedir() while tracing
// and scandir's it; on Windows that hits the ACL-protected `Application Data` junction and fails
// the build with EPERM (CI = Linux never sees it). Pointing the BUILD process's home env at an
// empty throwaway dir makes the trace scan a safe folder instead. This is gated on the production-
// build phase: `next start` and `next dev` load this same config module, so an unconditional
// top-level mutation would (wrongly) redirect os.homedir() at RUNTIME — breaking ~/.agentroom data
// resolution (POSIX) and the working_dir allow-root (Windows). Replaces the Next-14-era
// `outputFileTracing: false`, which is removed in Next 16.
export default function nextConfigFn(phase) {
  // 'phase-production-build' === PHASE_PRODUCTION_BUILD (from 'next/constants'); compared as a
  // literal to avoid importing a CJS module into this ESM config.
  if (phase === 'phase-production-build') {
    const buildTraceHome = path.join(os.tmpdir(), 'agentroom-build-trace-home')
    fs.mkdirSync(buildTraceHome, { recursive: true })
    process.env.HOME = buildTraceHome
    process.env.USERPROFILE = buildTraceHome
  }
  return nextConfig
}
