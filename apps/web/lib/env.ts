import { z } from 'zod'

/**
 * Boot-time environment validation for the web app (server side), run once at
 * startup via `instrumentation.ts`.
 *
 * Local single-user app: there is NO required server env anymore (no Supabase, no
 * auth keys). The app stores everything locally via @agentroom/db. We keep a
 * minimal validator so the boot hook has a stable entry point and any optional
 * config is checked with a clear, named error rather than failing cryptically later.
 */
const serverEnvSchema = z.object({
  // Optional: sets the CSRF same-origin allowlist + absolute URLs behind a proxy.
  NEXT_PUBLIC_APP_URL: z.string().url('must be a valid URL').optional(),
  // Optional: where local app-data (SQLite + files) lives; defaults per-OS.
  AGENTROOM_HOME: z.string().optional(),
})

type ServerEnv = z.infer<typeof serverEnvSchema>

/** Validate a raw env record (defaults to `process.env`). Throws on failure. */
export function validateServerEnv(
  raw: Record<string, string | undefined> = process.env,
): ServerEnv {
  const result = serverEnvSchema.safeParse(raw)
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    )
    throw new Error(`Invalid web environment:\n${lines.join('\n')}`)
  }
  return result.data
}
