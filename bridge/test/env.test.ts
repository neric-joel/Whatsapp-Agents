import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadBridgeEnv } from '../src/lib/env.js'

// Local-only bridge: there are no required env vars anymore (no Supabase). Every
// field is optional with a safe default; only malformed BRIDGE_* values are rejected.

test('loadBridgeEnv accepts an empty environment and fills safe defaults', () => {
  const env = loadBridgeEnv({})
  assert.equal(env.BRIDGE_WORKER_ID, 'bridge-local-1')
  assert.equal(env.BRIDGE_POLL_INTERVAL_MS, 2000)
  assert.equal(env.BRIDGE_MAX_CONCURRENT_RUNS, 3)
  assert.equal(env.BRIDGE_HEARTBEAT_INTERVAL_MS, 5000)
  assert.equal(env.BRIDGE_STALE_RUN_TIMEOUT_MS, 60000)
  assert.equal(env.BRIDGE_HEALTH_PORT, 9090)
})

test('loadBridgeEnv rejects a non-numeric / out-of-range interval and names it', () => {
  assert.throws(() => loadBridgeEnv({ BRIDGE_POLL_INTERVAL_MS: 'soon' }), /BRIDGE_POLL_INTERVAL_MS/)
})

test('loadBridgeEnv rejects an out-of-range health port and names it', () => {
  assert.throws(() => loadBridgeEnv({ BRIDGE_HEALTH_PORT: '70000' }), /BRIDGE_HEALTH_PORT/)
})

test('loadBridgeEnv coerces numeric strings to numbers', () => {
  const env = loadBridgeEnv({ BRIDGE_MAX_CONCURRENT_RUNS: '5' })
  assert.equal(env.BRIDGE_MAX_CONCURRENT_RUNS, 5)
})
