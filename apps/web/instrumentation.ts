/**
 * Next.js instrumentation hook — runs once when the server process boots.
 * We validate the server environment here so a misconfigured deployment fails
 * fast (naming the bad var) instead of erroring on the first request.
 *
 * Only runs in the Node.js server runtime (not Edge, not the browser).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateServerEnv } = await import('@/lib/env')
    validateServerEnv()
  }
}
