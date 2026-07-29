import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  decryptSecret,
  encryptSecret,
  getCredentialKey,
  hasCredentialKey,
} from '@agentroom/shared/credential-crypto'

// A deterministic 32-byte test key (hex). Real keys come from CREDENTIAL_ENCRYPTION_KEY.
const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
const key = getCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: KEY_HEX } as NodeJS.ProcessEnv)

test('AES-256-GCM round-trips a secret', () => {
  const plain = 'sk-test-ABC123_super-secret-value'
  const enc = encryptSecret(plain, key)
  assert.notEqual(enc.ciphertext, plain, 'ciphertext is not the plaintext')
  assert.ok(enc.nonce.length > 0)
  assert.equal(decryptSecret(enc, key), plain)
})

test('a fresh nonce is used each time (no deterministic ciphertext reuse)', () => {
  const a = encryptSecret('same input', key)
  const b = encryptSecret('same input', key)
  assert.notEqual(a.ciphertext, b.ciphertext, 'two encryptions differ (random nonce)')
  assert.notEqual(a.nonce, b.nonce)
})

test('decrypt with the WRONG key fails (no silent garbage)', () => {
  const enc = encryptSecret('secret', key)
  const wrong = getCredentialKey({
    CREDENTIAL_ENCRYPTION_KEY: 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100',
  } as NodeJS.ProcessEnv)
  assert.throws(() => decryptSecret(enc, wrong))
})

test('a tampered ciphertext fails the GCM auth tag', () => {
  const enc = encryptSecret('secret', key)
  const raw = Buffer.from(enc.ciphertext, 'base64')
  raw[0] = raw[0]! ^ 0xff // flip a byte
  assert.throws(() => decryptSecret({ ciphertext: raw.toString('base64'), nonce: enc.nonce }, key))
})

test('key validation: requires a 32-byte hex or base64 key', () => {
  assert.throws(() => getCredentialKey({} as NodeJS.ProcessEnv), /not set/)
  assert.throws(
    () => getCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: 'tooshort' } as NodeJS.ProcessEnv),
    /32 bytes/,
  )
  assert.equal(hasCredentialKey({} as NodeJS.ProcessEnv), false)
  assert.equal(hasCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: KEY_HEX } as NodeJS.ProcessEnv), true)
  // strict standard base64 (43 chars + '=' padding) also accepted
  const b64 = Buffer.from(KEY_HEX, 'hex').toString('base64')
  assert.equal(hasCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: b64 } as NodeJS.ProcessEnv), true)
})

test('strict base64url (43 chars, unpadded) is accepted', () => {
  const b64url = Buffer.from(KEY_HEX, 'hex').toString('base64url')
  assert.equal(hasCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: b64url } as NodeJS.ProcessEnv), true)
  const parsed = getCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: b64url } as NodeJS.ProcessEnv)
  assert.equal(parsed.toString('hex'), KEY_HEX)
})

// REGRESSION (CWE-521 / findings.md C2): Node's base64 decoder silently drops
// out-of-alphabet characters, so a 43-44 character passphrase like this one decodes
// to exactly 32 bytes under the OLD lenient `Buffer.from(x, 'base64')` fallback and
// was wrongly accepted as a "256-bit key" — carrying only ~40-60 bits of real entropy.
// This test MUST fail against the pre-fix code (confirmed by stashing the fix and
// re-running: the old code returns a 32-byte key with no throw).
test('a passphrase that happens to decode to 32 bytes under lenient base64 is REJECTED', () => {
  const passphrase = 'my-super-secret-agentroom-master-passphrase!'
  // Sanity-check the premise: Node's lenient decoder really does produce 32 bytes here.
  assert.equal(Buffer.from(passphrase, 'base64').length, 32)
  assert.throws(
    () => getCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: passphrase } as NodeJS.ProcessEnv),
    /openssl rand -hex 32/,
  )
  assert.equal(
    hasCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: passphrase } as NodeJS.ProcessEnv),
    false,
  )
})

test('a 63-char hex string is rejected with an actionable message (not silently re-parsed as base64)', () => {
  const hex63 = KEY_HEX.slice(1) // 63 chars
  assert.throws(
    () => getCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: hex63 } as NodeJS.ProcessEnv),
    /openssl rand -hex 32/,
  )
})

test('a 65-char hex string is rejected with an actionable message', () => {
  const hex65 = KEY_HEX + '0'
  assert.throws(
    () => getCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: hex65 } as NodeJS.ProcessEnv),
    /openssl rand -hex 32/,
  )
})
