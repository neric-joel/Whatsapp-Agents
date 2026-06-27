import {
  encryptSecret,
  getCredentialKey,
  hasCredentialKey,
} from '@agentroom/shared/credential-crypto'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { createCredentialSchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'
import { getDb, newId, intBool } from '@agentroom/db'

/**
 * WS2 (ADR-0010) — per-user BYO provider credentials. The secret is AES-256-GCM
 * encrypted server-side before storage and is NEVER returned to the browser: list/create
 * return metadata only + `has_secret`. Owner-scoped throughout (single local user).
 */

// SECURITY: only metadata is ever read back — secret_ciphertext/secret_nonce stay server-side.
const METADATA_COLUMNS = 'id, provider, label, base_url, is_default, created_at'

type CredentialMetadataRow = {
  id: string
  provider: string
  label: string
  base_url: string | null
  is_default: number
  created_at: string
}

// SQLite stores is_default as INTEGER 0/1; rehydrate the boolean the Postgres column returned.
function toMetadata(row: CredentialMetadataRow) {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    base_url: row.base_url,
    is_default: row.is_default === 1,
    created_at: row.created_at,
    has_secret: true,
  }
}

export async function GET(req: NextRequest) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const db = getDb()
  try {
    const rows = db
      .prepare(
        `SELECT ${METADATA_COLUMNS} FROM user_credentials WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .all(user.id) as CredentialMetadataRow[]

    // Never expose the ciphertext/nonce; surface only that a secret exists.
    return apiSuccess(rows.map(toMetadata))
  } catch (e) {
    return internalError('credentials list', e)
  }
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

  const db = getDb()
  try {
    // Only one default per (user, provider) — clear an existing default before setting a new one.
    if (input.is_default) {
      db.prepare(
        `UPDATE user_credentials SET is_default = 0 WHERE user_id = ? AND provider = ? AND is_default = 1`,
      ).run(user.id, input.provider)
    }

    const created = db
      .prepare(
        `INSERT INTO user_credentials
           (id, user_id, provider, label, secret_ciphertext, secret_nonce, base_url, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${METADATA_COLUMNS}`,
      )
      .get(
        newId(),
        user.id,
        input.provider,
        input.label,
        enc.ciphertext,
        enc.nonce,
        input.base_url ?? null,
        intBool(input.is_default ?? false),
      ) as CredentialMetadataRow | undefined

    if (!created) return internalError('credential create', new Error('insert returned no row'))

    return apiSuccess(toMetadata(created), 201)
  } catch (e) {
    return internalError('credential create', e)
  }
}
