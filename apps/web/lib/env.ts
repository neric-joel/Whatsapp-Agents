import { z } from 'zod'

/**
 * Boot-time environment validation for the web app (server side).
 *
 * Validated once at server startup via `instrumentation.ts` so a
 * misconfiguration fails fast with a message that NAMES the bad var, instead of
 * surfacing as a cryptic Supabase "Invalid URL" at request time.
 *
 * CRITICAL (see CLAUDE.md §7): the publishable key var is
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — never `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 * We explicitly reject the deprecated name to catch copy-paste mistakes early.
 */

const serverEnvSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url('must be a valid URL (e.g. http://localhost:54321)'),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .min(1, 'is required (the publishable/anon key)'),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'is required (server-only service-role key)'),
    NEXT_PUBLIC_APP_URL: z.string().url('must be a valid URL').optional(),
    // Deprecated name — if present, the operator likely used the wrong var.
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.NEXT_PUBLIC_SUPABASE_ANON_KEY && !val.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
        message:
          'is required — you set the deprecated NEXT_PUBLIC_SUPABASE_ANON_KEY; rename it to NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (CLAUDE.md §7)',
      })
    }
  })

export type ServerEnv = z.infer<typeof serverEnvSchema>

/** Validate a raw env record (defaults to `process.env`). Throws on failure. */
export function validateServerEnv(
  raw: Record<string, string | undefined> = process.env,
): ServerEnv {
  const result = serverEnvSchema.safeParse(raw)
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(
      `Invalid web environment — fix apps/web/.env.local (see apps/web/.env.example):\n${lines.join('\n')}`,
    )
  }
  return result.data
}
