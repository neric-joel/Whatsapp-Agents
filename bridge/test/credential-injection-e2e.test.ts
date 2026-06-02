import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AgentEvent, ContextPacketV1, RuntimeCredential } from '@agentroom/shared'

import { SubprocessAdapter } from '../src/adapters/subprocess-adapter.js'

/**
 * Key-leak red-team (ADR-0010 / WS2): spawn a REAL child via SubprocessAdapter and
 * confirm the resolved BYO credential reaches exactly that child's one env var, while
 * a process.env secret is NOT forwarded. This proves the end-to-end injection path
 * (resolveRuntimeProvider → buildChildEnv inject seam → spawn env) on a live process,
 * without needing a real provider account.
 */
class EnvProbeAdapter extends SubprocessAdapter {
  readonly name = 'env-probe'
  protected resolveCommand(): string {
    return process.execPath // node
  }
  protected buildArgs(): string[] {
    // The child reports which env vars it can see, as a final_response the adapter parses.
    // Uses a CANARY var name that is NOT on the base allowlist or the provider pattern, so
    // it can ONLY be present via the inject seam (a real OPENAI_API_KEY could otherwise be
    // forwarded from process.env via the host-login allowlist, masking the test).
    const script =
      "const o={schema_version:1,run_id:'probe',content:JSON.stringify(" +
      '{injected:process.env.BYO_CANARY_KEY??null,base:process.env.BYO_CANARY_BASE??null,' +
      'leaked:process.env.SUPABASE_SERVICE_ROLE_KEY??null}),content_type:"text"};' +
      "process.stdout.write(JSON.stringify(o)+'\\n')"
    return ['-e', script]
  }
  protected envVarName(): string {
    return 'NODE'
  }
}

const packet: ContextPacketV1 = {
  schema_version: 1,
  run_id: 'probe',
  room: {
    id: 'r',
    name: 'R',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
  },
  agent: { id: 'a', name: 'A', slug: 'a', system_prompt: null, provider: 'codex' },
  trigger_message: {
    id: 'm',
    content: 'hi',
    sender_type: 'user',
    created_at: '2026-06-01T00:00:00.000Z',
  },
  recent_messages: [],
  round_index: 0,
  discussion_mode: 'independent',
  deliberation_depth: 0,
  deliberation_root_id: null,
}

async function collect(
  adapter: SubprocessAdapter,
  runtime?: RuntimeCredential,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const e of adapter.run(packet, new AbortController().signal, runtime)) events.push(e)
  return events
}

test('injected credential reaches the child env; process.env secrets do NOT', async () => {
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-leak-canary'
  try {
    const events = await collect(new EnvProbeAdapter(), {
      envVarName: 'BYO_CANARY_KEY',
      secret: 'sk-injected-canary',
      baseUrl: 'https://proxy.example/v1',
      baseUrlEnvName: 'BYO_CANARY_BASE',
    })
    const final = events.find((e) => e.type === 'final_response')
    assert.ok(final && final.type === 'final_response', 'child produced a final_response')
    const seen = JSON.parse(final.response.content) as {
      injected: string | null
      base: string | null
      leaked: string | null
    }
    assert.equal(seen.injected, 'sk-injected-canary', 'the resolved key reached the child')
    assert.equal(seen.base, 'https://proxy.example/v1', 'base_url reached the child')
    assert.equal(
      seen.leaked,
      null,
      'process.env service-role secret was NOT forwarded to the child',
    )
  } finally {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY']
  }
})

test('without a runtime credential the child sees no injected key', async () => {
  const events = await collect(new EnvProbeAdapter())
  const final = events.find((e) => e.type === 'final_response')
  assert.ok(final && final.type === 'final_response')
  const seen = JSON.parse(final.response.content) as { injected: string | null }
  assert.equal(seen.injected, null, 'no inject → no key in the child env')
})
