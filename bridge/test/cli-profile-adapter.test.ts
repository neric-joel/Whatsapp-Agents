import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import type { AgentEvent, ContextPacketV1 } from '@agentroom/shared'

// Isolate config.json in a throwaway home BEFORE importing the modules that read it.
const tmp = mkdtempSync(join(tmpdir(), 'agentroom-cliprofile-'))
const prevHome = process.env['AGENTROOM_HOME']
process.env['AGENTROOM_HOME'] = tmp

const { upsertProfile } = await import('@agentroom/db')
const { CliProfileAdapter } = await import('../src/adapters/cli-profile-adapter.js')

after(() => {
  rmSync(tmp, { recursive: true, force: true })
  // Restore AGENTROOM_HOME so a future parallel runner can't see this deleted temp dir.
  if (prevHome === undefined) delete process.env['AGENTROOM_HOME']
  else process.env['AGENTROOM_HOME'] = prevHome
})

// A generic CLI that reads the prompt from stdin and prints a reply, echoing FOO so
// per-profile env injection can be asserted.
const GENERIC_SCRIPT =
  "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log('REPLY:'+(process.env.FOO||'noenv')+':'+d.length))"

function packetFor(provider: string): ContextPacketV1 {
  return {
    schema_version: 1,
    run_id: 'run-cli',
    room: {
      id: 'r',
      name: 'R',
      reply_mode: 'everyone',
      max_agent_rounds: 3,
      discussion_mode: 'independent',
    },
    agent: { id: 'a', name: 'A', slug: 'a', system_prompt: null, provider },
    trigger_message: {
      id: 'm',
      content: 'hello there',
      sender_type: 'user',
      created_at: '2026-06-27T00:00:00.000Z',
    },
    recent_messages: [],
    round_index: 0,
    discussion_mode: 'independent',
    deliberation_depth: 0,
    deliberation_root_id: null,
  }
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

before(() => {})

test('runs the configured binary and surfaces its stdout as the reply', async () => {
  const profile = upsertProfile({
    name: 'Echo CLI',
    slug: 'echo',
    bin: process.execPath, // node
    args: ['-e', GENERIC_SCRIPT],
    kind: 'generic',
    enabled: true,
  })
  const events = await collect(
    new CliProfileAdapter().run(packetFor(profile.id), new AbortController().signal),
  )
  const final = events.find((e) => e.type === 'final_response')
  assert.ok(final, 'expected a final_response')
  assert.match((final as { response: { content: string } }).response.content, /REPLY:noenv:/)
})

test('injects per-profile env into the child', async () => {
  const profile = upsertProfile({
    name: 'Echo CLI Env',
    slug: 'echoenv',
    bin: process.execPath,
    args: ['-e', GENERIC_SCRIPT],
    kind: 'generic',
    enabled: true,
    env: { FOO: 'bar' },
  })
  const events = await collect(
    new CliProfileAdapter().run(packetFor(profile.id), new AbortController().signal),
  )
  const final = events.find((e) => e.type === 'final_response')
  assert.match((final as { response: { content: string } }).response.content, /REPLY:bar:/)
})

test('errors clearly when the agent has no matching profile', async () => {
  const events = await collect(
    new CliProfileAdapter().run(packetFor('no-such-profile-id'), new AbortController().signal),
  )
  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 'error')
  assert.match((events[0] as { message: string }).message, /No connected CLI/)
})

test('errors when the matching profile is disabled', async () => {
  const profile = upsertProfile({
    name: 'Off CLI',
    slug: 'off',
    bin: process.execPath,
    args: ['-e', GENERIC_SCRIPT],
    kind: 'generic',
    enabled: false,
  })
  const events = await collect(
    new CliProfileAdapter().run(packetFor(profile.id), new AbortController().signal),
  )
  assert.equal(events[0]?.type, 'error')
  assert.match((events[0] as { message: string }).message, /turned off/)
})
