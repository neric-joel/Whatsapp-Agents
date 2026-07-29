import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { beforeEach, test } from 'node:test'

import { clearRegisteredSecrets, redact, redactDeep, registerSecret } from '../src/redact.js'

// The known-secret registry is module state; without this a test that fills it would
// leave every later test running against a dirty (and full) registry.
beforeEach(clearRegisteredSecrets)

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
  // Body is base64url-distributed (`-` mapped to `_`, which a real PAT body also uses and
  // the rule's class accepts). A hand-typed 59-char `b` run preceded by `_` is matched by
  // the generic base64 rule on the UNFIXED code, so it would assert nothing.
  const pat = `github_pat_${randomBytes(62).toString('base64url').replace(/-/g, '_')}`
  assert.equal(redact(pat), '[REDACTED]')
})

// --- Labelled values: space-separated labels + Bearer ---------------------------------------

test('redacts space-separated labels and a Bearer value', () => {
  assert.equal(redact('api key: hunter2hunter2'), '[REDACTED]')
  assert.equal(redact('API Key = hunter2hunter2'), '[REDACTED]')
  assert.equal(redact('api_key: hunter2hunter2'), '[REDACTED]')
  assert.equal(redact('token: Bearer hunter2hunter2'), '[REDACTED]')
  assert.equal(redact('secret = Bearer hunter2hunter2'), '[REDACTED]')
})

test('the label rule does NOT mangle ordinary prose about HTTP auth', () => {
  // redact() runs over agent replies persisted to `messages` and rendered in the UI, so a
  // room whose agents write HTTP/auth code must not have its output shredded. `credential`
  // and `authorization` are covered as redactDeep KEY names, not as prose labels.
  for (const line of [
    'To call the API, set the Authorization: Bearer <token> header.',
    'const authorization = req.headers.get("authorization")',
    'HTTP 401 means Authorization: missing or malformed.',
    'Store the credential: the CLI reads it from the keychain.',
  ]) {
    assert.equal(redact(line), line, `mangled: ${line}`)
  }
})

test('a label cannot be joined across a newline', () => {
  // `\s` in the label would splice a markdown bullet ending in "api" onto the next line.
  const md = '- supported: api\nkey: value pairs are fine'
  assert.equal(redact(md), md)
})

// --- Idempotency ---------------------------------------------------------------------------

test('redacting twice changes nothing', () => {
  const samples = [
    ...CONTEXTS.map((c) => c.wrap(antKey())),
    ...CONTEXTS.map((c) => c.wrap(projKey())),
    'api key: hunter2hunter2',
    'token: Bearer hunter2hunter2',
    `Authorization: Bearer ${antKey()}`,
    'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdHNpZ25hdHVyZQ',
    'payload=VGhpcyBpcyBhIHNlY3JldCB2YWx1ZSB0aGF0IHNob3VsZCBiZSBoaWRkZW4=',
    'token=[REDACTED:base64]',
  ]
  for (const sample of samples) {
    const once = redact(sample)
    assert.equal(redact(once), once, `not idempotent: ${sample}`)
  }
})

test('re-redacting stored text preserves the existing marker (digits in the guard)', () => {
  // The guard is `(?::[a-z0-9]+)?` — with `[a-z]+` it cannot consume "base64", so an
  // already-redacted string gets its marker rewritten on a second pass through redact().
  assert.equal(redact('token=[REDACTED:base64]'), 'token=[REDACTED:base64]')
  assert.equal(redact('token=[REDACTED:jwt]'), 'token=[REDACTED:jwt]')
  assert.equal(redact('token: Bearer [REDACTED:base64]'), 'token: Bearer [REDACTED:base64]')
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

test('redactDeep does not fabricate a secret for a null/undefined value', () => {
  const out = redactDeep({ token: null, apiKey: undefined, secret: '' }) as Record<string, unknown>
  assert.equal(out.token, null)
  assert.equal(out.apiKey, undefined)
  // The guard is null/undefined-only, so an empty string still redacts. Asserted so the
  // boundary is explicit rather than incidental.
  assert.equal(out.secret, '[REDACTED]')
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

test('the registry stays bounded (least-recently-registered evicted)', () => {
  const first = `evict-me-${randomBytes(12).toString('hex')}`
  registerSecret(first)
  assert.equal(redact(first), '[REDACTED]')
  for (let i = 0; i < 128; i++) registerSecret(`filler-${i}-${randomBytes(12).toString('hex')}`)
  assert.equal(redact(first), first)
})

test('re-registering refreshes recency, so the hottest secret is not evicted first', () => {
  // resolveRuntimeProvider registers on EVERY run, so the most-used credential is
  // re-registered constantly. FIFO-without-refresh would still treat it as the oldest and
  // drop it the moment the registry filled — losing the control exactly where it matters.
  const hot = `hot-${randomBytes(12).toString('hex')}`
  registerSecret(hot)
  for (let i = 0; i < 63; i++) registerSecret(`other-${i}-${randomBytes(12).toString('hex')}`)
  for (let i = 0; i < 200; i++) registerSecret(hot) // re-used on every run
  registerSecret(`newcomer-${randomBytes(12).toString('hex')}`) // evicts one entry
  assert.equal(redact(hot), '[REDACTED]', 'the hot secret was evicted despite constant reuse')
})

test('clearRegisteredSecrets forgets everything (rotation / teardown)', () => {
  const secret = `rotate-me-${randomBytes(12).toString('hex')}`
  registerSecret(secret)
  assert.equal(redact(secret), '[REDACTED]')
  clearRegisteredSecrets()
  assert.equal(redact(secret), secret)
})
