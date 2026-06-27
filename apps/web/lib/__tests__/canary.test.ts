import { runCanary } from '@agentroom/shared'
import { describe, expect, it } from 'vitest'

describe('runCanary — grounding gate', () => {
  it('flags a confident claim that data lives in Supabase (the real-world bug)', () => {
    const r = runCanary('Your messages are stored in a Supabase PostgreSQL database.')
    expect(r.status).toBe('flagged')
    expect(r.reasons.join(' ')).toMatch(/Supabase/i)
  })

  it('flags a "saved to a ChatGPT workspace" claim', () => {
    const r = runCanary('This chat is saved by the ChatGPT workspace service in the cloud.')
    expect(r.status).toBe('flagged')
  })

  it('flags "backed by Postgres" / "uses Firebase"', () => {
    expect(runCanary('The app is backed by Postgres.').status).toBe('flagged')
    expect(runCanary('It uses Firebase for storage.').status).toBe('flagged')
  })

  it('does NOT flag a correct denial of the forbidden backend (negation guard)', () => {
    const r = runCanary('This is not stored in Supabase — it is a local SQLite database.')
    expect(r.status).not.toBe('flagged')
  })

  it('verifies the correct, grounded answer', () => {
    const r = runCanary('The conversation is stored in a local SQLite database under ~/.agentroom.')
    expect(r.status).toBe('verified')
    expect(r.reasons).toEqual([])
  })
})

describe('runCanary — weaker signals', () => {
  it('marks hedging as unverified, not flagged', () => {
    const r = runCanary('I think the capital might possibly be some city, I am not sure.')
    expect(r.status).toBe('unverified')
  })

  it('marks an unqualified absolute as unverified', () => {
    expect(runCanary('This is scientifically proven and always works, guaranteed.').status).toBe(
      'unverified',
    )
  })

  it('verifies a plain factual statement', () => {
    expect(runCanary('The capital of France is Paris.').status).toBe('verified')
  })
})
