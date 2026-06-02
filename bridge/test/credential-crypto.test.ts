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
  // base64 form also accepted
  const b64 = Buffer.from(KEY_HEX, 'hex').toString('base64')
  assert.equal(hasCredentialKey({ CREDENTIAL_ENCRYPTION_KEY: b64 } as NodeJS.ProcessEnv), true)
})
