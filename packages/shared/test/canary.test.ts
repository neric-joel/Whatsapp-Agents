import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runCanary } from '../src/canary.js'

// --- Grounding gate (strongest -> flagged) -------------------------------------------------

test('flags a confident claim that data lives in Supabase (the real-world bug)', () => {
  const r = runCanary('Your messages are stored in a Supabase PostgreSQL database.')
  assert.equal(r.status, 'flagged')
  assert.match(r.reasons.join(' '), /Supabase/i)
})

test('flags a "saved to a ChatGPT workspace" claim', () => {
  assert.equal(
    runCanary('This chat is saved by the ChatGPT workspace service in the cloud.').status,
    'flagged',
  )
})

test('flags "backed by Postgres" / "uses Firebase"', () => {
  assert.equal(runCanary('The app is backed by Postgres.').status, 'flagged')
  assert.equal(runCanary('It uses Firebase for storage.').status, 'flagged')
})

test('does NOT flag a correct denial of the forbidden backend (negation near the term)', () => {
  assert.notEqual(
    runCanary('This is not stored in Supabase — it is a local SQLite database.').status,
    'flagged',
  )
})

test('STILL flags when negation is elsewhere in the sentence (no whole-sentence bypass)', () => {
  assert.equal(
    runCanary("It's not local — your data actually lives in Supabase Postgres.").status,
    'flagged',
  )
  assert.equal(runCanary("Don't worry, it uses Supabase to store everything.").status, 'flagged')
})

test('verifies the correct, grounded answer', () => {
  const r = runCanary('The conversation is stored in a local SQLite database under ~/.agentroom.')
  assert.equal(r.status, 'verified')
  assert.deepEqual(r.reasons, [])
})

// --- Weaker behavioral signals (-> unverified) ---------------------------------------------

test('marks hedging as unverified, not flagged', () => {
  assert.equal(
    runCanary('I think the capital might possibly be some city, I am not sure.').status,
    'unverified',
  )
})

test('marks an unqualified absolute as unverified', () => {
  assert.equal(
    runCanary('This is scientifically proven and always works, guaranteed.').status,
    'unverified',
  )
})

test('verifies a plain factual statement', () => {
  assert.equal(runCanary('The capital of France is Paris.').status, 'verified')
})

// --- Precision: off-topic / citation false positives (#67) ---------------------------------

test('does NOT flag a generic, non-app-referential backend mention (off-topic FP)', () => {
  assert.equal(runCanary('Postgres is what most apps use.').status, 'verified')
  assert.equal(
    runCanary('Most applications store their data in a Postgres database.').status,
    'verified',
  )
  assert.equal(runCanary('Supabase is a popular backend choice for many teams.').status, 'verified')
})

test('citation: flags an attribution with no URL in the sentence', () => {
  assert.equal(runCanary('According to Professor Lee, the result holds.').status, 'unverified')
})

test('citation: a URL LATER in the same sentence suppresses the flag', () => {
  assert.equal(
    runCanary('According to the project README at https://example.com/readme, it is fine.').status,
    'verified',
  )
})

// --- Regression: the grounding gate must NOT miss bare-noun storage claims -----------------
// (Critique HIGH: an inclusion-list app-subject gate dropped these natural phrasings. The
// exclusion-list design must keep flagging them — they are the exact hallucination class the
// gate exists to catch.)

test('STILL flags bare-noun storage claims (no explicit app-subject token)', () => {
  for (const s of [
    'Messages are stored in a Supabase database.',
    'Conversations are saved to Firebase.',
    'Data is persisted in a cloud database.',
    'All messages live in a remote database.',
    'Files are kept in cloud storage.',
    'The room data is backed by Redis.',
  ]) {
    assert.equal(runCanary(s).status, 'flagged', `should flag: ${s}`)
  }
})

test('STILL flags when the subject is split off by a comma (clause-split bypass)', () => {
  assert.equal(
    runCanary('Your messages, by the way, are stored in Supabase Postgres.').status,
    'flagged',
  )
})

test('app-referential storage claims still flag', () => {
  assert.equal(runCanary('AgentRoom is backed by a cloud database.').status, 'flagged')
  assert.equal(runCanary('Your messages are stored in a Supabase database.').status, 'flagged')
})
