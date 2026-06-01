import assert from 'node:assert/strict'
import { test } from 'node:test'

import { encryptSecret, getCredentialKey } from '@agentroom/shared/credential-crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveRuntimeProvider } from '../src/lib/resolve-runtime-provider.js'

const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const env = { CREDENTIAL_ENCRYPTION_KEY: KEY_HEX } as NodeJS.ProcessEnv
const key = getCredentialKey(env)

interface CredRow {
  secret_ciphertext: string
  secret_nonce: string
  base_url: string | null
}

function fakeSupabase(row: CredRow | null): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return { from: () => builder } as unknown as SupabaseClient
}

function cred(secret: string, baseUrl: string | null = null): CredRow {
  const enc = encryptSecret(secret, key)
  return { secret_ciphertext: enc.ciphertext, secret_nonce: enc.nonce, base_url: baseUrl }
}

test('codex-cli resolves OPENAI_API_KEY and decrypts the secret', async () => {
  const rc = await resolveRuntimeProvider({
    supabase: fakeSupabase(cred('sk-user-openai')),
    adapterType: 'codex-cli',
    credentialId: 'c1',
    ownerUserId: 'u1',
    env,
  })
  assert.ok(rc)
  assert.equal(rc.envVarName, 'OPENAI_API_KEY')
  assert.equal(rc.secret, 'sk-user-openai')
})

test('claude-code resolves ANTHROPIC_API_KEY', async () => {
  const rc = await resolveRuntimeProvider({
    supabase: fakeSupabase(cred('sk-ant')),
    adapterType: 'claude-code',
    credentialId: 'c1',
    ownerUserId: 'u1',
    env,
  })
  assert.equal(rc?.envVarName, 'ANTHROPIC_API_KEY')
  assert.equal(rc?.secret, 'sk-ant')
})

test('base_url is passed through with the per-adapter env name', async () => {
  const rc = await resolveRuntimeProvider({
    supabase: fakeSupabase(cred('sk-x', 'https://proxy.example/v1')),
    adapterType: 'codex-cli',
    credentialId: 'c1',
    ownerUserId: 'u1',
    env,
  })
  assert.equal(rc?.baseUrl, 'https://proxy.example/v1')
  assert.equal(rc?.baseUrlEnvName, 'OPENAI_BASE_URL')
})

test('returns null for the non-injectable / unconfigured cases', async () => {
  const row = cred('x')
  // adapter not in the map (host-login / mock)
  assert.equal(
    await resolveRuntimeProvider({
      supabase: fakeSupabase(row),
      adapterType: 'mock',
      credentialId: 'c1',
      ownerUserId: 'u1',
      env,
    }),
    null,
  )
  // no bound credential → host login
  assert.equal(
    await resolveRuntimeProvider({
      supabase: fakeSupabase(row),
      adapterType: 'codex-cli',
      credentialId: null,
      ownerUserId: 'u1',
      env,
    }),
    null,
  )
  // feature disabled (no decryption key)
  assert.equal(
    await resolveRuntimeProvider({
      supabase: fakeSupabase(row),
      adapterType: 'codex-cli',
      credentialId: 'c1',
      ownerUserId: 'u1',
      env: {} as NodeJS.ProcessEnv,
    }),
    null,
  )
  // missing / cross-owner row (the owner-scoped query returns nothing)
  assert.equal(
    await resolveRuntimeProvider({
      supabase: fakeSupabase(null),
      adapterType: 'codex-cli',
      credentialId: 'c1',
      ownerUserId: 'u1',
      env,
    }),
    null,
  )
})

test('fails CLOSED (null) when the key cannot decrypt the secret', async () => {
  const wrong = {
    CREDENTIAL_ENCRYPTION_KEY: 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100',
  } as NodeJS.ProcessEnv
  const rc = await resolveRuntimeProvider({
    supabase: fakeSupabase(cred('secret')),
    adapterType: 'codex-cli',
    credentialId: 'c1',
    ownerUserId: 'u1',
    env: wrong,
  })
  assert.equal(rc, null)
})
