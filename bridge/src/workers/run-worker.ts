import { createServiceClient } from '../lib/supabase.js'
import { getAdapter } from '../adapters/registry.js'
import type { ContextPacketV1, AgentProvider, ReplyMode, SenderType } from '@agentroom/shared'

const WORKER_ID = process.env.BRIDGE_WORKER_ID ?? 'bridge-local-1'

function log(runId: string, status: string) {
  console.log(`[BRIDGE] [${new Date().toISOString()}] worker=${WORKER_ID} run=${runId} status=${status}`)
}

interface AgentInfo {
  id: string
  name: string
  slug: string
  system_prompt: string | null
  provider: string
  adapter_type: string
}

interface AgentRunRow {
  id: string
  room_id: string
  agent_id: string
  trigger_msg_id: string | null
  status: string
  round_index: number
  agents: AgentInfo | null
}

export async function processRun(runId: string): Promise<void> {
  const supabase = createServiceClient()

  // a. Fetch run with agent data
  const { data: runRaw } = await supabase
    .from('agent_runs')
    .select('id, room_id, agent_id, trigger_msg_id, status, round_index, agents!agent_id(id, name, slug, system_prompt, provider, adapter_type)')
    .eq('id', runId)
    .single()

  if (!runRaw) return
  const runRow = runRaw as unknown as AgentRunRow

  try {
    // b. Atomically claim
    const { data: claimed } = await supabase
      .from('agent_runs')
      .update({ status: 'claimed', worker_id: WORKER_ID, started_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('status', 'queued')
      .select('id')
      .single()

    if (!claimed) {
      log(runId, 'skipped (already claimed)')
      return
    }
    log(runId, 'claimed')

    // c. Update to running
    await supabase.from('agent_runs').update({ status: 'running' }).eq('id', runId)
    log(runId, 'running')

    // d. Fetch trigger message
    const fallbackMsg = { id: runId, content: '(no trigger)', sender_type: 'user', created_at: new Date().toISOString() }
    let triggerMsg = fallbackMsg
    if (runRow.trigger_msg_id) {
      const { data: tm } = await supabase
        .from('messages')
        .select('id, content, sender_type, created_at')
        .eq('id', runRow.trigger_msg_id)
        .single()
      if (tm) triggerMsg = tm as typeof triggerMsg
    }

    // e. Fetch recent messages
    const { data: recentRaw } = await supabase
      .from('messages')
      .select('id, content, sender_type, sender_agent_id, created_at')
      .eq('room_id', runRow.room_id)
      .order('created_at', { ascending: true })
      .limit(10)
    type RecentMsg = { id: string; content: string; sender_type: string; sender_agent_id: string | null; created_at: string }
    const recentMessages = (recentRaw ?? []) as RecentMsg[]

    // Fetch room
    const { data: roomRaw } = await supabase
      .from('rooms')
      .select('id, name, reply_mode, max_agent_rounds')
      .eq('id', runRow.room_id)
      .single()
    if (!roomRaw) throw new Error(`Room ${runRow.room_id} not found`)
    const room = roomRaw as unknown as { id: string; name: string; reply_mode: string; max_agent_rounds: number }

    const agentInfo = runRow.agents
    if (!agentInfo) throw new Error('Agent info missing from run row')

    // f. Build ContextPacketV1
    const packet: ContextPacketV1 = {
      schema_version: 1,
      run_id: runId,
      room: {
        id: room.id,
        name: room.name,
        reply_mode: room.reply_mode as ReplyMode,
        max_agent_rounds: room.max_agent_rounds,
      },
      agent: {
        id: agentInfo.id,
        name: agentInfo.name,
        slug: agentInfo.slug,
        system_prompt: agentInfo.system_prompt,
        provider: agentInfo.provider as AgentProvider,
      },
      trigger_message: {
        id: triggerMsg.id,
        content: triggerMsg.content,
        sender_type: triggerMsg.sender_type as SenderType,
        created_at: triggerMsg.created_at,
      },
      recent_messages: recentMessages.map((m) => ({
        id: m.id,
        content: m.content,
        sender_type: m.sender_type as SenderType,
        sender_agent_id: m.sender_agent_id,
        created_at: m.created_at,
      })),
      round_index: runRow.round_index,
    }

    // g. Run adapter, collect final response
    const adapter = getAdapter(agentInfo.adapter_type ?? 'mock')
    const controller = new AbortController()
    let finalContent = ''

    for await (const event of adapter.run(packet, controller.signal)) {
      if (event.type === 'final_response') {
        finalContent = event.response.content
      }
    }

    if (!finalContent) throw new Error('Adapter produced no final_response')

    // h. Insert agent reply into messages
    await supabase.from('messages').insert({
      room_id: runRow.room_id,
      sender_type: 'agent',
      sender_agent_id: runRow.agent_id,
      content: finalContent,
      content_type: 'text',
      round_index: runRow.round_index,
    })

    // i. Mark run completed
    await supabase
      .from('agent_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', runId)
    log(runId, 'completed')

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from('agent_runs')
      .update({ status: 'failed', error_message: message })
      .eq('id', runId)
    log(runId, 'failed')
    throw err
  }
}
