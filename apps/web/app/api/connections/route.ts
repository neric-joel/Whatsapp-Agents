import { detectKnownClis, listProfiles, probeCommand, upsertProfile } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { upsertCliProfileSchema } from '@/lib/api-validation'

// Detection + the config.json read both spawn child processes / touch disk — force
// the Node runtime (never the Edge runtime).
export const runtime = 'nodejs'

/**
 * Connections screen data: auto-detected known CLIs (PATH probe + `--version`) plus
 * the user's saved CLI profiles, each freshly health-checked. AgentRoom never asks
 * for a CLI's credentials — detection only reports whether the binary runs; auth is
 * the CLI's own job (see docs/CONNECTING_CLIS.md).
 */
export async function GET() {
  // Each call spawns `--version` probes (detection + one per saved profile). They're bounded
  // by the subprocess time/output caps, but throttle anyway so a hot-looping client can't
  // amplify process spawns (#65). Same-origin single-user, so a generous window is fine.
  const limited = enforceRateLimit('connections-list', 30, 60_000)
  if (limited) return limited
  try {
    const [detected, savedProfiles] = await Promise.all([
      detectKnownClis(),
      Promise.resolve(listProfiles()),
    ])
    const profiles = await Promise.all(
      savedProfiles.map(async (p) => ({ ...p, probe: await probeCommand(p.bin) })),
    )
    return apiSuccess({ detected, profiles })
  } catch (e) {
    return internalError('connections list', e)
  }
}

/**
 * Create or update a CLI profile (auto-detected "Connect" or a manual BYO CLI).
 * Writes config.json and returns the saved profile with a fresh health probe.
 */
export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const limited = enforceRateLimit('connections-upsert', 60, 60_000)
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = upsertCliProfileSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid CLI profile', 400, parsed.error.flatten())
  }
  const input = parsed.data

  try {
    const saved = upsertProfile({
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      slug: input.slug,
      bin: input.bin,
      args: input.args ?? [],
      ...(input.env ? { env: input.env } : {}),
      kind: input.kind ?? 'generic',
      enabled: input.enabled ?? true,
    })
    const probe = await probeCommand(saved.bin)
    return apiSuccess({ ...saved, probe }, 201)
  } catch (e) {
    return internalError('connections upsert', e)
  }
}
