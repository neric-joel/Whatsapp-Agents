import type { RuntimeCredential } from '@agentroom/shared'
import {
  decryptSecret,
  getCredentialKey,
  hasCredentialKey,
} from '@agentroom/shared/credential-crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * resolveRuntimeProvider — the Hermes analog (ADR-0010 / WS2). Given an agent's
 * adapter type + bound credential + creator, load the creator's stored credential
 * (service-role), decrypt it, and return the env var the adapter's CLI reads its key
 * from. Returns `null` (→ unchanged host-login behavior) whenever BYO does not apply.
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

export interface ResolveRuntimeProviderArgs {
  supabase: SupabaseClient
  adapterType: string | null | undefined
  credentialId: string | null | undefined
  /** The agent's creator — the credential MUST belong to them ("owner brings fuel"). */
  ownerUserId: string | null | undefined
  env?: NodeJS.ProcessEnv
}

export async function resolveRuntimeProvider({
  supabase,
  adapterType,
  credentialId,
  ownerUserId,
  env = process.env,
}: ResolveRuntimeProviderArgs): Promise<RuntimeCredential | null> {
  const map = adapterType ? ADAPTER_CREDENTIAL_ENV[adapterType] : undefined
  if (!map) return null // adapter takes no injected key (mock, ruflo, myclaude, …)
  if (!credentialId || !ownerUserId) return null // no bound credential → host login
  if (!hasCredentialKey(env)) return null // feature disabled (no decryption key)

  // Owner-scoped load: the credential must belong to the agent's creator. Service-role
  // read; RLS would also deny cross-user, this is defense-in-depth at the query.
  const { data, error } = await supabase
    .from('user_credentials')
    .select('secret_ciphertext, secret_nonce, base_url')
    .eq('id', credentialId)
    .eq('user_id', ownerUserId)
    .maybeSingle()
  if (error || !data) return null

  const row = data as { secret_ciphertext: string; secret_nonce: string; base_url: string | null }
  let secret: string
  try {
    secret = decryptSecret(
      { ciphertext: row.secret_ciphertext, nonce: row.secret_nonce },
      getCredentialKey(env),
    )
  } catch {
    // Wrong/rotated key or tampered ciphertext — fail CLOSED (fall back to host login),
    // never crash the run and never leak a partial value.
    return null
  }

  return {
    envVarName: map.envVar,
    secret,
    ...(row.base_url && map.baseUrlEnv
      ? { baseUrl: row.base_url, baseUrlEnvName: map.baseUrlEnv }
      : {}),
  }
}
