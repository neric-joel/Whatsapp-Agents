import { getDb, intBool } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { getAuthenticatedUser } from '@/lib/auth'

interface RouteParams {
  params: Promise<{ id: string }>
}

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

/**
 * WS2 (ADR-0010) — toggle the `is_default` flag on one of the caller's own provider
 * credentials. Owner-scoped: filtered by `user_id = caller`, so a user can never mutate
 * another's credential. Preserves the single-default-per-(user, provider) invariant: when
 * a credential is made the default, any sibling default for the same provider is cleared.
 */
export async function PATCH(req: NextRequest, props: RouteParams) {
  const params = await props.params
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const limited = enforceRateLimit(`credential-update:${user.id}`, 30, 60_000)
  if (limited) return limited

  const body = await req.json().catch(() => null)
  if (!body || typeof body.is_default !== 'boolean') {
    return apiError('VALIDATION_ERROR', 'is_default (boolean) is required', 400)
  }
  const isDefault: boolean = body.is_default

  const db = getDb()
  try {
    // Owner-scoped lookup — never leak/mutate another user's credential.
    const existing = db
      .prepare(`SELECT id, provider FROM user_credentials WHERE id = ? AND user_id = ?`)
      .get(params.id, user.id) as { id: string; provider: string } | undefined
    if (!existing) {
      return apiError('NOT_FOUND', 'Credential not found', 404)
    }

    // Only one default per (user, provider) — clear an existing default before setting a new one.
    if (isDefault) {
      db.prepare(
        `UPDATE user_credentials SET is_default = 0 WHERE user_id = ? AND provider = ? AND is_default = 1`,
      ).run(user.id, existing.provider)
    }

    const updated = db
      .prepare(
        `UPDATE user_credentials SET is_default = ? WHERE id = ? AND user_id = ? RETURNING ${METADATA_COLUMNS}`,
      )
      .get(intBool(isDefault), params.id, user.id) as CredentialMetadataRow | undefined

    if (!updated) return internalError('credential update', new Error('update returned no row'))

    return apiSuccess(toMetadata(updated))
  } catch (e) {
    return internalError('credential update', e)
  }
}

/**
 * WS2 (ADR-0010) — delete one of the caller's own provider credentials. Owner-scoped:
 * the delete is filtered by `user_id = caller`, so a user can never delete another's
 * credential. Agents referencing it have `credential_id` set to NULL (FK ON DELETE SET
 * NULL) and fall back to host-login.
 */
export async function DELETE(req: NextRequest, props: RouteParams) {
  const params = await props.params
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const limited = enforceRateLimit(`credential-delete:${user.id}`, 30, 60_000)
  if (limited) return limited

  const db = getDb()
  try {
    const deleted = db
      .prepare(`DELETE FROM user_credentials WHERE id = ? AND user_id = ? RETURNING id`)
      .get(params.id, user.id) as { id: string } | undefined
    if (!deleted) {
      return apiError('NOT_FOUND', 'Credential not found', 404)
    }

    return apiSuccess({ id: params.id, deleted: true })
  } catch (e) {
    return internalError('credential delete', e)
  }
}
