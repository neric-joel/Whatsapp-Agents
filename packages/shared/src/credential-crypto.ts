import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * App-layer AES-256-GCM envelope for BYO provider secrets (ADR-0010 / WS2).
 *
 * The web API encrypts a user's secret before storing it; the bridge decrypts it
 * (server-side only) at spawn to inject one env var into the child CLI. The 256-bit
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

// Exactly three accepted shapes, each an unambiguous encoding of 32 bytes, checked by
// regex BEFORE any decode call. This is deliberate: Node's base64 decoder silently
// discards out-of-alphabet characters, so a lenient decode-then-length-check would
// accept a passphrase (e.g. a 43-44 character sentence) as a "256-bit key" carrying
// far less real entropy — see findings.md C2 / CWE-521. A passphrase must be rejected
// outright, not coerced into a weak key.
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/
const BASE64_KEY_RE = /^[A-Za-z0-9+/]{43}=$/
const BASE64URL_KEY_RE = /^[A-Za-z0-9_-]{43}$/

const KEY_MISSING_ERROR = 'CREDENTIAL_ENCRYPTION_KEY is not set (required to use BYO credentials)'

const KEY_FORMAT_ERROR =
  'CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (256-bit) via one of these EXACT ' +
  'forms: 64 hex characters, standard base64 (43 characters + "=" padding), or base64url ' +
  '(43 characters, no padding) — a passphrase is not a valid key. Generate one with: ' +
  'openssl rand -hex 32'

/**
 * Why the key is unusable. `'missing'` and `'malformed'` are deliberately NOT the same
 * thing: an install carried over from before the entropy check (below) has a key that
 * IS set, and telling its operator "not set" sends them to look at an env file that
 * already contains the value. `message` is the actionable text and never contains any
 * part of the key.
 */
export type CredentialKeyFailure = 'missing' | 'malformed'

export class CredentialKeyError extends Error {
  readonly reason: CredentialKeyFailure

  constructor(reason: CredentialKeyFailure, message: string) {
    super(message)
    this.name = 'CredentialKeyError'
    this.reason = reason
  }
}

/** Parse + validate the 256-bit key from env. Accepts strict hex(64) or base64/base64url(32 bytes). */
export function getCredentialKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env['CREDENTIAL_ENCRYPTION_KEY']
  if (!raw || raw.trim() === '') {
    throw new CredentialKeyError('missing', KEY_MISSING_ERROR)
  }
  const trimmed = raw.trim()
  let key: Buffer
  if (HEX_KEY_RE.test(trimmed)) {
    key = Buffer.from(trimmed, 'hex')
  } else if (BASE64_KEY_RE.test(trimmed)) {
    key = Buffer.from(trimmed, 'base64')
  } else if (BASE64URL_KEY_RE.test(trimmed)) {
    key = Buffer.from(trimmed, 'base64url')
  } else {
    throw new CredentialKeyError('malformed', KEY_FORMAT_ERROR)
  }
  // Belt-and-braces: every branch above already pins the decoded length to 32 bytes by
  // construction, but keep the check so a future regex edit fails closed, not open.
  if (key.length !== 32) {
    throw new CredentialKeyError('malformed', KEY_FORMAT_ERROR)
  }
  return key
}

/**
 * The reason the key is unusable, or `null` when it is usable — the feature gate every
 * caller should use instead of a boolean.
 *
 * This replaces a `hasCredentialKey()` predicate that collapsed both failures into
 * `false`. Callers then had nothing left to report but their own guess, and both guessed
 * "not set": the web API answered 503 "CREDENTIAL_ENCRYPTION_KEY is not set" for a key
 * that was set but rejected, and the bridge fell back to host login with no log line at
 * all. KEY_FORMAT_ERROR — the one message that says how to fix it — was unreachable
 * through both paths. Returning the reason keeps the gate fail-closed (a malformed key
 * is still never used) while making it diagnosable.
 */
export function credentialKeyFailure(
  env: NodeJS.ProcessEnv = process.env,
): { reason: CredentialKeyFailure; message: string } | null {
  try {
    getCredentialKey(env)
    return null
  } catch (e) {
    if (e instanceof CredentialKeyError) return { reason: e.reason, message: e.message }
    // Unreachable today: getCredentialKey throws nothing else. Fail closed anyway
    // rather than reporting a usable key because an unexpected error type appeared.
    return { reason: 'malformed', message: KEY_FORMAT_ERROR }
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
