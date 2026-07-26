import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { WorkingDirRevalidationError } from '@agentroom/db'
import type { AgentEvent, ContextPacketV1 } from '@agentroom/shared'

import { SubprocessAdapter } from '../src/adapters/subprocess-adapter.js'

class CwdProbeAdapter extends SubprocessAdapter {
  readonly name = 'cwd-probe'

  protected resolveCommand(): string {
    return process.execPath
  }

  protected buildArgs(): string[] {
    return ['-e', 'console.log(process.cwd())']
  }

  protected envVarName(): string {
    return 'NODE'
  }
}

const basePacket: ContextPacketV1 = {
  schema_version: 1,
  run_id: 'cwd-run',
  room: {
    id: 'room-1',
    name: 'Room',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
  },
  agent: { id: 'agent-1', name: 'Agent', slug: 'agent', system_prompt: null, provider: 'mock' },
  trigger_message: {
    id: 'msg-1',
    content: 'pwd',
    sender_type: 'user',
    created_at: '2026-07-24T00:00:00.000Z',
  },
  recent_messages: [],
  round_index: 0,
  discussion_mode: 'independent',
  deliberation_depth: 0,
  deliberation_root_id: null,
}

async function collectEvents(packet: ContextPacketV1): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of new CwdProbeAdapter().run(packet, new AbortController().signal)) {
    events.push(event)
  }
  return events
}

function finalContent(events: AgentEvent[]): string {
  const final = events.find((event) => event.type === 'final_response')
  assert.ok(final && final.type === 'final_response', 'child produced a final response')
  return final.response.content
}

test('subprocess adapter spawns the child in the validated session working_dir', async () => {
  const prevRoot = process.env['AGENTROOM_WORKSPACE_ROOT']
  const base = mkdtempSync(join(tmpdir(), 'agentroom-cwd-test-'))
  const root = join(base, 'workspace')
  const inside = join(root, 'project')
  try {
    await mkdir(inside, { recursive: true })
    process.env['AGENTROOM_WORKSPACE_ROOT'] = root

    const events = await collectEvents({ ...basePacket, working_dir: inside })

    assert.equal(finalContent(events), realpathSync(inside))
  } finally {
    if (prevRoot === undefined) delete process.env['AGENTROOM_WORKSPACE_ROOT']
    else process.env['AGENTROOM_WORKSPACE_ROOT'] = prevRoot
    rmSync(base, { recursive: true, force: true })
  }
})

test('subprocess adapter leaves cwd undefined when working_dir is null or missing', async () => {
  const inherited = realpathSync(process.cwd())

  assert.equal(finalContent(await collectEvents({ ...basePacket, working_dir: null })), inherited)
  assert.equal(finalContent(await collectEvents(basePacket)), inherited)
})

test('subprocess adapter rejects an outside working_dir before spawning', async () => {
  const prevRoot = process.env['AGENTROOM_WORKSPACE_ROOT']
  const base = mkdtempSync(join(tmpdir(), 'agentroom-cwd-test-'))
  const root = join(base, 'workspace')
  const outside = join(base, 'outside')
  try {
    await Promise.all([mkdir(root, { recursive: true }), mkdir(outside, { recursive: true })])
    process.env['AGENTROOM_WORKSPACE_ROOT'] = root

    await assert.rejects(
      () => collectEvents({ ...basePacket, working_dir: outside }),
      WorkingDirRevalidationError,
    )
  } finally {
    if (prevRoot === undefined) delete process.env['AGENTROOM_WORKSPACE_ROOT']
    else process.env['AGENTROOM_WORKSPACE_ROOT'] = prevRoot
    rmSync(base, { recursive: true, force: true })
  }
})
