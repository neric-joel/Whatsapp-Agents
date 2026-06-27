import { z } from 'zod'

/**
 * Boot-time environment validation for the Bridge Daemon.
 *
 * Fails fast with a single, readable message that NAMES every missing/invalid
 * variable, instead of letting `undefined` flow into the Supabase client or
 * `NaN` into the poll loop. Keep this in sync with `bridge/.env.example`.
 */

const intFromEnv = (def: number, min = 1) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(min))

// Like intFromEnv but allows 0 (used to DISABLE the health server / a feature).
const portFromEnv = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(0).max(65535))

const bridgeEnvSchema = z.object({
  // Local-only: the bridge reads/writes the local SQLite DB (@agentroom/db); no
  // Supabase service client is needed. Every field below is optional with a safe default.
  BRIDGE_WORKER_ID: z.string().min(1).default('bridge-local-1'),
  BRIDGE_POLL_INTERVAL_MS: intFromEnv(2000, 100),
  BRIDGE_MAX_CONCURRENT_RUNS: intFromEnv(3, 1),
  BRIDGE_HEARTBEAT_INTERVAL_MS: intFromEnv(5000, 100),
  BRIDGE_STALE_RUN_TIMEOUT_MS: intFromEnv(60000, 1000),
  // Liveness/metrics HTTP server port. 0 disables it (default 9090).
  BRIDGE_HEALTH_PORT: portFromEnv(9090),
})

type BridgeEnv = z.infer<typeof bridgeEnvSchema>

/** Validate a raw env record (defaults to `process.env`). Throws on failure. */
export function loadBridgeEnv(raw: Record<string, string | undefined> = process.env): BridgeEnv {
  const result = bridgeEnvSchema.safeParse(raw)
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    )
    throw new Error(
      `Invalid Bridge environment — fix bridge/.env (see bridge/.env.example):\n${lines.join('\n')}`,
    )
  }
  return result.data
}
