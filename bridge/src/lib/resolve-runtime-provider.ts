import { getDb } from '@agentroom/db'
import { registerSecret, type RuntimeCredential } from '@agentroom/shared'
import {
  credentialKeyFailure,
  decryptSecret,
  getCredentialKey,
} from '@agentroom/shared/credential-crypto'

import { log } from './logger.js'

/**
 * resolveRuntimeProvider — the Hermes analog (ADR-0010 / WS2). Given an agent's
 * adapter type + bound credential + creator, load the stored credential
 * (server-side only), decrypt it, and return the env var the adapter's CLI reads its
 * key from. Returns `null` (→ unchanged host-login behavior) whenever BYO does not apply.
 *
 * The decrypted secret is runtime-only: it flows bridge → adapter out-of-band and is
 * injected into exactly one child env var (never argv, the stdin packet, or logs).
 */

/** Which env var each adapter's CLI reads its API key from (+ optional base-url var). */
const ADAPTER_CREDENTIAL_ENV: Record<string, { envVar: string; baseUrlEnv?: string }> = {
  'claude-code': { envVar: 'ANTHROPIC_API_KEY' },
  subprocess: { envVar: 'ANTHROPIC_API_KEY' }, // claude-code alias (seed uses 'subprocess')
  'codex-cli': { envVar: 'OPENAI_API_KEY', baseUrlEnv: 'OPENAI_BASE_URL' },
}

interface ResolveRuntimeProviderArgs {
  adapterType: string | null | undefined
  credentialId: string | null | undefined
  /** The agent's creator — the credential MUST belong to them ("owner brings fuel"). */
  ownerUserId: string | null | undefined
  env?: NodeJS.ProcessEnv
}

export async function resolveRuntimeProvider({
  adapterType,
  credentialId,
  ownerUserId,
  env = process.env,
}: ResolveRuntimeProviderArgs): Promise<RuntimeCredential | null> {
  const map = adapterType ? ADAPTER_CREDENTIAL_ENV[adapterType] : undefined
  if (!map) return null // adapter takes no injected key (e.g. mock)
  if (!credentialId || !ownerUserId) return null // no bound credential → host login

  // Past this line the agent HAS a bound credential, so every `return null` below is a
  // silent downgrade to host login — the run still succeeds (or fails auth inside the
  // CLI) with nothing anywhere saying why. This used to be `if (!hasCredentialKey(env))
  // return null` with no log at all, which is how an install whose key stopped being
  // accepted looked exactly like an install that never had one.
  const keyFailure = credentialKeyFailure(env)
  if (keyFailure) {
    log('warn', 'credential.key.unusable', {
      reason: keyFailure.reason, // 'missing' | 'malformed' — never the key itself
      detail: keyFailure.message,
      credential_id: credentialId,
      adapter_type: adapterType,
    })
    return null // fail closed: run on host login rather than with a key we can't trust
  }

  // Owner-scoped load: the credential must belong to the agent's creator — the WHERE clause
  // enforces it (the local app has no RLS, so this query is the authorization boundary).
  const db = getDb()
  const data = db
    .prepare(
      'SELECT secret_ciphertext, secret_nonce, base_url FROM user_credentials WHERE id = ? AND user_id = ?',
    )
    .get(credentialId, ownerUserId) as
    | { secret_ciphertext: string; secret_nonce: string; base_url: string | null }
    | undefined
  if (!data) return null

  const row = data
  let secret: string
  try {
    secret = decryptSecret(
      { ciphertext: row.secret_ciphertext, nonce: row.secret_nonce },
      getCredentialKey(env),
    )
  } catch {
    // Wrong/rotated key or tampered ciphertext — fail CLOSED (fall back to host login),
    // never crash the run and never leak a partial value. Logged for the same reason as
    // the key check above: this is exactly what a key rotation looks like from here, and
    // the fix (re-enter the stored credential) is invisible without a line saying so.
    // The caught error is deliberately not logged — GCM failures carry no useful detail
    // and the value is a secret.
    log('warn', 'credential.decrypt_failed', {
      credential_id: credentialId,
      adapter_type: adapterType,
      detail:
        'stored credential could not be decrypted with CREDENTIAL_ENCRYPTION_KEY (rotated key or tampered ciphertext); re-enter it in Settings → Providers',
    })
    return null
  }

  // Format-independent backstop: redact() strips this exact value from every string it
  // sees from here on, so a key format no pattern anticipates still cannot reach a log,
  // the error sink, or a persisted message.
  registerSecret(secret)

  return {
    envVarName: map.envVar,
    secret,
    ...(row.base_url && map.baseUrlEnv
      ? { baseUrl: row.base_url, baseUrlEnvName: map.baseUrlEnv }
      : {}),
  }
}
