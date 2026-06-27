import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { encryptSecret, getCredentialKey } from '@agentroom/shared/credential-crypto'

import { resolveRuntimeProvider } from '../src/lib/resolve-runtime-provider.js'
import { freshTestDb, type TestDb } from './helpers/test-db.js'

const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const env = { CREDENTIAL_ENCRYPTION_KEY: KEY_HEX } as NodeJS.ProcessEnv
const key = getCredentialKey(env)

let h: TestDb

beforeEach(() => {
  h = freshTestDb()
})

afterEach(() => {
  h.cleanup()
})

/**
 * Seed a user_credentials row the same way the original fakeSupabase row provided it:
 * encrypt `secret` with the test key (AES-256-GCM envelope) and store the
 * ciphertext/nonce (+ optional base_url). Returns the credential id.
 *
 * Owner-scoping: the source loads `WHERE id = ? AND user_id = ?`, so seed under the
 * owner we will query with. Defaults to id 'c1' / user 'u1' to match the call args.
 */
function seedCred(
  secret: string,
  baseUrl: string | null = null,
  { id = 'c1', userId = 'u1' }: { id?: string; userId?: string } = {},
): string {
  const enc = encryptSecret(secret, key)
  h.db
    .prepare(
      `INSERT INTO user_credentials
         (id, user_id, provider, label, secret_ciphertext, secret_nonce, base_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, 'openai', 'test cred', enc.ciphertext, enc.nonce, baseUrl)
  return id
}

test('codex-cli resolves OPENAI_API_KEY and decrypts the secret', async () => {
  seedCred('sk-user-openai')
  const rc = await resolveRuntimeProvider({
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
  seedCred('sk-ant')
  const rc = await resolveRuntimeProvider({
    adapterType: 'claude-code',
    credentialId: 'c1',
    ownerUserId: 'u1',
    env,
  })
  assert.equal(rc?.envVarName, 'ANTHROPIC_API_KEY')
  assert.equal(rc?.secret, 'sk-ant')
})

test('base_url is passed through with the per-adapter env name', async () => {
  seedCred('sk-x', 'https://proxy.example/v1')
  const rc = await resolveRuntimeProvider({
    adapterType: 'codex-cli',
    credentialId: 'c1',
    ownerUserId: 'u1',
    env,
  })
  assert.equal(rc?.baseUrl, 'https://proxy.example/v1')
  assert.equal(rc?.baseUrlEnvName, 'OPENAI_BASE_URL')
})

test('returns null for the non-injectable / unconfigured cases', async () => {
  // A valid, owner-matching credential row exists for the cases that get that far.
  seedCred('x')

  // adapter not in the map (host-login / mock)
  assert.equal(
    await resolveRuntimeProvider({
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
      adapterType: 'codex-cli',
      credentialId: 'c1',
      ownerUserId: 'u1',
      env: {} as NodeJS.ProcessEnv,
    }),
    null,
  )
})

test('returns null when the owner-scoped row is missing / cross-owner', async () => {
  // Row exists but belongs to a DIFFERENT owner → the owner-scoped query returns nothing.
  seedCred('x', null, { id: 'c1', userId: 'someone-else' })
  assert.equal(
    await resolveRuntimeProvider({
      adapterType: 'codex-cli',
      credentialId: 'c1',
      ownerUserId: 'u1',
      env,
    }),
    null,
  )
})

test('fails CLOSED (null) when the key cannot decrypt the secret', async () => {
  // Stored under the real key, but resolved with a different (wrong) key.
  seedCred('secret')
  const wrong = {
    CREDENTIAL_ENCRYPTION_KEY: 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100',
  } as NodeJS.ProcessEnv
  const rc = await resolveRuntimeProvider({
    adapterType: 'codex-cli',
    credentialId: 'c1',
    ownerUserId: 'u1',
    env: wrong,
  })
  assert.equal(rc, null)
})
