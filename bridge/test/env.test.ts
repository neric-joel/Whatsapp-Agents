import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadBridgeEnv } from '../src/lib/env.js'

const VALID: Record<string, string | undefined> = {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
}

test('loadBridgeEnv accepts a minimal valid environment with defaults', () => {
  const env = loadBridgeEnv({ ...VALID })
  assert.equal(env.SUPABASE_URL, 'http://localhost:54321')
  assert.equal(env.BRIDGE_WORKER_ID, 'bridge-local-1')
  assert.equal(env.BRIDGE_POLL_INTERVAL_MS, 2000)
  assert.equal(env.BRIDGE_MAX_CONCURRENT_RUNS, 3)
})

test('loadBridgeEnv throws and NAMES a missing required var', () => {
  assert.throws(
    () => loadBridgeEnv({ SUPABASE_URL: 'http://localhost:54321' }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  )
})

test('loadBridgeEnv rejects a non-URL SUPABASE_URL', () => {
  assert.throws(() => loadBridgeEnv({ ...VALID, SUPABASE_URL: 'not-a-url' }), /SUPABASE_URL/)
})

test('loadBridgeEnv rejects a non-numeric / out-of-range interval', () => {
  assert.throws(
    () => loadBridgeEnv({ ...VALID, BRIDGE_POLL_INTERVAL_MS: 'soon' }),
    /BRIDGE_POLL_INTERVAL_MS/,
  )
})

test('loadBridgeEnv coerces numeric strings to numbers', () => {
  const env = loadBridgeEnv({ ...VALID, BRIDGE_MAX_CONCURRENT_RUNS: '5' })
  assert.equal(env.BRIDGE_MAX_CONCURRENT_RUNS, 5)
})
