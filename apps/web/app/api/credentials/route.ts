import {
  encryptSecret,
  getCredentialKey,
  hasCredentialKey,
} from '@agentroom/shared/credential-crypto'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { createCredentialSchema } from '@/lib/api-validation'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

/**
 * WS2 (ADR-0010) — per-user BYO provider credentials. The secret is AES-256-GCM
 * encrypted server-side before storage and is NEVER returned to the browser: list/create
 * return metadata only + `has_secret`. Owner-scoped throughout (RLS + service-role writes).
 */

const METADATA_COLUMNS = 'id, provider, label, base_url, is_default, created_at, updated_at'

export async function GET(req: NextRequest) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('user_credentials')
    .select(METADATA_COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (error) return internalError('credentials list', error)

  // Never expose the ciphertext/nonce; surface only that a secret exists.
  return apiSuccess((data ?? []).map((c) => ({ ...c, has_secret: true })))
}

export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const limited = enforceRateLimit(`credential-create:${user.id}`, 20, 60_000)
  if (limited) return limited

  if (!hasCredentialKey()) {
    return apiError(
      'SERVICE_UNAVAILABLE',
      'Provider credentials are disabled on this server (CREDENTIAL_ENCRYPTION_KEY is not set).',
      503,
    )
  }

  const body = await req.json().catch(() => null)
  const parsed = createCredentialSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parsed.error.flatten())
  }
  const input = parsed.data

  let enc: { ciphertext: string; nonce: string }
  try {
    enc = encryptSecret(input.secret, getCredentialKey())
  } catch (e) {
    return internalError('credential encrypt', e)
  }

  const supabase = createSupabaseServiceClient()

  // Only one default per (user, provider) — clear an existing default before setting a new one.
  if (input.is_default) {
    await supabase
      .from('user_credentials')
      .update({ is_default: false })
      .eq('user_id', user.id)
      .eq('provider', input.provider)
      .eq('is_default', true)
  }

  const { data: created, error } = await supabase
    .from('user_credentials')
    .insert({
      user_id: user.id,
      provider: input.provider,
      label: input.label,
      secret_ciphertext: enc.ciphertext,
      secret_nonce: enc.nonce,
      base_url: input.base_url ?? null,
      is_default: input.is_default ?? false,
    })
    .select(METADATA_COLUMNS)
    .single()
  if (error || !created) return internalError('credential create', error)

  return apiSuccess({ ...created, has_secret: true }, 201)
}
