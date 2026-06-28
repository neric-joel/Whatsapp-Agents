import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * App-layer AES-256-GCM envelope for BYO provider secrets (ADR-0010 / WS2).
 *
 * The web API encrypts a user's secret before storing it; the bridge decrypts it
 * (service-role only) at spawn to inject one env var into the child CLI. The 256-bit
 * key comes from `CREDENTIAL_ENCRYPTION_KEY` (server-only env, never the browser,
 * never logged). GCM provides confidentiality + integrity (a tampered ciphertext or
 * wrong key fails to decrypt rather than yielding garbage).
 */

const ALGO = 'aes-256-gcm'
const NONCE_BYTES = 12 // GCM standard
const TAG_BYTES = 16

export interface EncryptedSecret {
  ciphertext: string // base64(ciphertext || authTag)
  nonce: string // base64(iv)
}

/** Parse + validate the 256-bit key from env. Accepts 64-hex or base64 (32 bytes). */
export function getCredentialKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env['CREDENTIAL_ENCRYPTION_KEY']
  if (!raw || raw.trim() === '') {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is not set (required to use BYO credentials)')
  }
  const trimmed = raw.trim()
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64')
  if (key.length !== 32) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (256-bit) — hex(64) or base64',
    )
  }
  return key
}

/** True if the env holds a usable 256-bit key (for boot validation / feature gating). */
export function hasCredentialKey(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    getCredentialKey(env)
    return true
  } catch {
    return false
  }
}

export function encryptSecret(plaintext: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    nonce: iv.toString('base64'),
  }
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  const data = Buffer.from(secret.ciphertext, 'base64')
  const iv = Buffer.from(secret.nonce, 'base64')
  if (data.length < TAG_BYTES + 1 || iv.length !== NONCE_BYTES) {
    throw new Error('malformed encrypted secret')
  }
  const enc = data.subarray(0, data.length - TAG_BYTES)
  const tag = data.subarray(data.length - TAG_BYTES)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
