import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'

import { redact, redactDeep, registerSecret } from '../src/redact.js'

// A realistic key body is base64url, so `-` and `_` appear at their natural ~3%
// frequency and break up the alphanumeric runs. Hand-written fixtures with long
// alphanumeric runs are accidentally caught by the generic base64 rule and pass
// even against the unfixed redactor — which is exactly why the original test missed
// the bug. Every key below is generated, never typed.
const antKey = () => `sk-ant-api03-${randomBytes(72).toString('base64url')}`
const projKey = () => `sk-proj-${randomBytes(72).toString('base64url')}`

const CONTEXTS: Array<{ name: string; wrap: (key: string) => string }> = [
  { name: 'bare', wrap: (k) => k },
  { name: 'prose', wrap: (k) => `Sure, the key I found is ${k} and it works.` },
  { name: 'json', wrap: (k) => `{"provider":"anthropic","apiKey":"${k}"}` },
  { name: 'bearer', wrap: (k) => `Authorization: Bearer ${k}` },
  { name: 'env line', wrap: (k) => `ANTHROPIC_API_KEY=${k}` },
]

/** True when any 16+ char contiguous slice of the secret survived redaction. */
function leaksFragment(secret: string, output: string): boolean {
  for (let i = 0; i + 16 <= secret.length; i++) {
    if (output.includes(secret.slice(i, i + 16))) return true
  }
  return false
}

// --- Provider keys: randomized, realistically distributed bodies -------------------------

test('leaks zero of 250 random sk-ant-api03 / sk-proj keys in any context', () => {
  for (const make of [antKey, projKey]) {
    for (let i = 0; i < 250; i++) {
      const key = make()
      for (const ctx of CONTEXTS) {
        const out = redact(ctx.wrap(key))
        assert.equal(out.includes(key), false, `${ctx.name}: whole key survived -> ${out}`)
        assert.equal(leaksFragment(key, out), false, `${ctx.name}: key fragment survived -> ${out}`)
      }
    }
  }
})

test('redacts a bare Anthropic key to exactly [REDACTED]', () => {
  assert.equal(redact(antKey()), '[REDACTED]')
  assert.equal(redact(projKey()), '[REDACTED]')
})

test('redacts other provider key formats', () => {
  const gh = `ghp_${randomBytes(27).toString('base64url').replace(/[-_]/g, 'a').slice(0, 36)}`
  const slack = `xoxb-${randomBytes(24).toString('base64url').replace(/_/g, 'a')}`
  const google = `AIza${randomBytes(30).toString('base64url').slice(0, 35)}`
  for (const key of [gh, slack, google]) {
    assert.equal(redact(`the key is ${key} ok`).includes(key), false, `leaked ${key}`)
  }
  assert.equal(redact(`github_pat_${'A'.repeat(20)}_${'b'.repeat(59)}`).includes('bbbb'), false)
})

// --- Labelled values: whitespace labels + Bearer ------------------------------------------

test('redacts whitespace-separated labels and a bare Bearer value', () => {
  assert.equal(redact('api key: hunter2hunter2'), '[REDACTED]')
  assert.equal(redact('API Key = hunter2hunter2'), '[REDACTED]')
  assert.equal(redact('credential: hunter2hunter2'), '[REDACTED]')
  assert.equal(redact('authorization: Bearer hunter2hunter2'), '[REDACTED]')
})

// --- Idempotency ---------------------------------------------------------------------------

test('redacting twice changes nothing', () => {
  const samples = [
    ...CONTEXTS.map((c) => c.wrap(antKey())),
    ...CONTEXTS.map((c) => c.wrap(projKey())),
    'api key: hunter2hunter2',
    'Authorization: Bearer hunter2hunter2',
    'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdHNpZ25hdHVyZQ',
    'payload=VGhpcyBpcyBhIHNlY3JldCB2YWx1ZSB0aGF0IHNob3VsZCBiZSBoaWRkZW4=',
  ]
  for (const sample of samples) {
    const once = redact(sample)
    assert.equal(redact(once), once, `not idempotent: ${sample}`)
  }
})

// --- Existing behaviour must still hold ----------------------------------------------------

test('still redacts JWTs, long base64 blobs, AKIA ids and the Supabase service key', () => {
  assert.equal(
    redact('token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdHNpZ25hdHVyZQ'),
    'token=[REDACTED:jwt]',
  )
  assert.equal(
    redact('payload=VGhpcyBpcyBhIHNlY3JldCB2YWx1ZSB0aGF0IHNob3VsZCBiZSBoaWRkZW4='),
    'payload=[REDACTED:base64]',
  )
  assert.equal(redact('aws AKIAIOSFODNN7EXAMPLE here'), 'aws [REDACTED] here')
  assert.equal(redact('SUPABASE_SERVICE_ROLE_KEY=abc.def-ghi'), '[REDACTED]')
})

test('leaves ordinary prose alone', () => {
  const prose = 'The room is stored in a local SQLite database under ~/.agentroom.'
  assert.equal(redact(prose), prose)
})

// --- redactDeep is key-name aware -----------------------------------------------------------

test('redactDeep redacts by KEY NAME whatever the value shape', () => {
  const out = redactDeep({
    apiKey: 'plain-not-a-known-format',
    api_key: 'plain-not-a-known-format',
    ANTHROPIC_API_KEY: 'plain-not-a-known-format',
    password: 'letmein',
    authorization: 'Basic dXNlcjpwdw',
    cookie: 'sid=1',
    private_key: { pem: '-----BEGIN PRIVATE KEY-----' },
    credentialId: 'c-1',
    run_id: 'r1',
    count: 3,
  }) as Record<string, unknown>

  for (const k of [
    'apiKey',
    'api_key',
    'ANTHROPIC_API_KEY',
    'password',
    'authorization',
    'cookie',
    'private_key',
    'credentialId',
  ]) {
    assert.equal(out[k], '[REDACTED]', `key ${k} was not redacted`)
  }
  assert.equal(out.run_id, 'r1')
  assert.equal(out.count, 3)
})

test('redactDeep still walks nested objects and arrays', () => {
  const key = antKey()
  const out = redactDeep({
    outer: { inner: [{ detail: `saw ${key}` }, { secret: 'nested-plaintext' }] },
  }) as { outer: { inner: Array<Record<string, unknown>> } }
  assert.equal(String(out.outer.inner[0]?.detail).includes(key), false)
  assert.equal(out.outer.inner[1]?.secret, '[REDACTED]')
})

// --- Known-secret registry (format-independent backstop) ------------------------------------

test('registerSecret makes redact() strip an unrecognisable secret verbatim', () => {
  const secret = 'zz.weird+format/value:that|matches|nothing'
  assert.equal(redact(`before ${secret} after`), `before ${secret} after`)
  registerSecret(secret)
  assert.equal(redact(`before ${secret} after`), 'before [REDACTED] after')
  // every shape, not just the one it was registered from
  assert.equal(redact(`{"k":"${secret}"}`).includes(secret), false)
  // repeat registration is a no-op, not a duplicate pass
  registerSecret(secret)
  assert.equal(redact(secret), '[REDACTED]')
})

test('registerSecret ignores short values that would shred ordinary text', () => {
  registerSecret('abc')
  assert.equal(redact('abc def'), 'abc def')
})

test('the registry stays bounded (oldest entries evicted)', () => {
  const first = `evict-me-${randomBytes(12).toString('hex')}`
  registerSecret(first)
  assert.equal(redact(first), '[REDACTED]')
  for (let i = 0; i < 128; i++) registerSecret(`filler-${i}-${randomBytes(12).toString('hex')}`)
  assert.equal(redact(first), first)
})
