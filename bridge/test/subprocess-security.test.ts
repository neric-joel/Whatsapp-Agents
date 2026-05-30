import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ContextPacketV1 } from '@agentroom/shared'

import { ClaudeCodeAdapter } from '../src/adapters/claude-code-adapter.js'
import {
  BinaryNotFoundError,
  buildChildEnv,
  resolveBinaryPath,
  resolveSpawnTarget,
} from '../src/lib/subprocess-security.js'

class TestClaudeCodeAdapter extends ClaudeCodeAdapter {
  args(packet: ContextPacketV1) {
    return this.buildArgs(packet)
  }
  stdin(packet: ContextPacketV1) {
    return this.buildStdin(packet)
  }
}

function packetWith(systemPrompt: string | null): ContextPacketV1 {
  return {
    schema_version: 1,
    run_id: 'run-1',
    room: {
      id: 'room-1',
      name: 'Demo',
      reply_mode: 'everyone',
      max_agent_rounds: 3,
      discussion_mode: 'independent',
    },
    agent: {
      id: 'agent-1',
      name: 'Claude Thinker',
      slug: 'claude-thinker',
      system_prompt: systemPrompt,
      provider: 'claude_code',
    },
    trigger_message: {
      id: 'msg-2',
      content: 'Answer this now',
      sender_type: 'user',
      created_at: '2026-05-16T00:01:00.000Z',
    },
    recent_messages: [
      {
        id: 'msg-2',
        content: 'Answer this now',
        sender_type: 'user',
        sender_agent_id: null,
        created_at: '2026-05-16T00:01:00.000Z',
        metadata: {},
      },
    ],
    round_index: 1,
    discussion_mode: 'independent',
    deliberation_depth: 0,
    deliberation_root_id: null,
  }
}

// --- buildChildEnv ---

test('buildChildEnv strips secrets and forwards only allowlisted vars', () => {
  const env = buildChildEnv({
    PATH: '/usr/bin',
    HOME: '/home/agent',
    SUPABASE_SERVICE_ROLE_KEY: 'super-secret',
    SUPABASE_URL: 'https://x.supabase.co',
    SOME_SECRET: 'nope',
    GITHUB_TOKEN: 'ghp_xxx',
    ANTHROPIC_API_KEY: 'sk-ant',
    OPENAI_API_KEY: 'sk-openai',
    RANDOM_APP_VAR: 'should-not-pass',
  })

  assert.equal(env['PATH'], '/usr/bin')
  assert.equal(env['HOME'], '/home/agent')
  assert.equal(env['ANTHROPIC_API_KEY'], 'sk-ant')
  assert.equal(env['OPENAI_API_KEY'], 'sk-openai')
  assert.equal(env['SUPABASE_SERVICE_ROLE_KEY'], undefined)
  assert.equal(env['SUPABASE_URL'], undefined)
  assert.equal(env['SOME_SECRET'], undefined)
  assert.equal(env['GITHUB_TOKEN'], undefined)
  assert.equal(env['RANDOM_APP_VAR'], undefined)
})

test('buildChildEnv honors BRIDGE_CHILD_ENV_ALLOW passthrough but never secrets', () => {
  const env = buildChildEnv({
    PATH: '/usr/bin',
    BRIDGE_CHILD_ENV_ALLOW: 'MY_CLI_HOME,RANDOM_APP_VAR',
    MY_CLI_HOME: '/opt/cli',
    RANDOM_APP_VAR: 'now-allowed',
    BRIDGE_SECRET_THING: 'must-stay-hidden',
  })

  assert.equal(env['MY_CLI_HOME'], '/opt/cli')
  assert.equal(env['RANDOM_APP_VAR'], 'now-allowed')
  // BRIDGE_* is a secret-pattern match and is stripped even though it is a var name.
  assert.equal(env['BRIDGE_SECRET_THING'], undefined)
})

// --- resolveBinaryPath ---

test('resolveBinaryPath resolves a bare command from PATH', () => {
  // node itself is guaranteed to be on PATH in the test runner.
  const resolved = resolveBinaryPath(process.platform === 'win32' ? 'node' : 'node')
  assert.ok(resolved.length > 0)
  assert.match(resolved, /node/i)
})

test('resolveBinaryPath throws BinaryNotFoundError for a missing command', () => {
  assert.throws(
    () => resolveBinaryPath('definitely-not-a-real-binary-xyz-123'),
    BinaryNotFoundError,
  )
})

test('resolveBinaryPath rejects a non-existent absolute path', () => {
  const bogus = process.platform === 'win32' ? 'C:\\nope\\bogus.exe' : '/nope/bogus'
  assert.throws(() => resolveBinaryPath(bogus), BinaryNotFoundError)
})

// --- resolveSpawnTarget ---

test('resolveSpawnTarget spawns a plain binary directly', () => {
  const t = resolveSpawnTarget('/usr/local/bin/claude', ['--print'], 'linux')
  assert.deepEqual(t, { command: '/usr/local/bin/claude', args: ['--print'] })
})

test('resolveSpawnTarget routes a Windows .cmd shim through cmd.exe with static args', () => {
  const t = resolveSpawnTarget(
    'C:\\bin\\claude.cmd',
    ['--print', '--output-format', 'json'],
    'win32',
    { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' },
  )
  assert.equal(t.command, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(t.args, [
    '/d',
    '/s',
    '/c',
    'C:\\bin\\claude.cmd',
    '--print',
    '--output-format',
    'json',
  ])
})

// --- argv injection regression ---

test('claude adapter never puts system_prompt in argv', () => {
  const adapter = new TestClaudeCodeAdapter()
  const malicious = '"; rm -rf / #'
  const args = adapter.args(packetWith(malicious))
  assert.deepEqual(args, ['--print', '--output-format', 'json'])
  assert.ok(!args.some((a) => a.includes('rm -rf')))
})

test('claude adapter delivers system_prompt via stdin instead', () => {
  const adapter = new TestClaudeCodeAdapter()
  const stdin = adapter.stdin(packetWith('You are a helpful pirate.'))
  assert.match(stdin, /System instructions defining your persona/)
  assert.match(stdin, /helpful pirate/)
})

test('claude adapter omits the system section when no system_prompt is set', () => {
  const adapter = new TestClaudeCodeAdapter()
  const stdin = adapter.stdin(packetWith(null))
  assert.doesNotMatch(stdin, /System instructions defining your persona/)
  assert.match(stdin, /You are Claude Thinker/)
})
