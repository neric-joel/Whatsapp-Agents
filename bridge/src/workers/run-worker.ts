import { createServiceClient } from '../lib/supabase.js'
import { isDeniedCommand } from '../lib/denylist.js'
import { log } from '../lib/logger.js'
import { redact } from '../lib/redact.js'
import { getAdapter } from '../adapters/registry.js'
import { buildContextPacket } from '../context/build-context-packet.js'
import { conclusionDetected } from '../lib/conclusion.js'
import { detectHallucination } from '../lib/hallucination.js'
import { sanitizeAgentOutput } from '../lib/agent-output.js'
import { maybeScheduleDiscussionContinuation } from '../lib/discussion-orchestrator.js'

const WORKER_ID = process.env.BRIDGE_WORKER_ID ?? 'bridge-local-1'

interface AgentInfo {
  id: string
  name: string
  slug: string
  system_prompt: string | null
  provider: string
  adapter_type: string
  tool_permissions: Record<string, unknown>
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
  const startedAt = Date.now()

  // a. Fetch run with agent data
  const { data: runRaw } = await supabase
    .from('agent_runs')
    .select('id, room_id, agent_id, trigger_msg_id, status, round_index, agents!agent_id(id, name, slug, system_prompt, provider, adapter_type, tool_permissions)')
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
      log('debug', 'run.skipped', { run_id: runId, reason: 'already_claimed' })
      return
    }
    log('info', 'run.start', { run_id: runId, agent_id: runRow.agent_id, room_id: runRow.room_id })

    // c. Update to running
    await supabase.from('agent_runs').update({ status: 'running' }).eq('id', runId)

    // d. Fetch trigger message
    const fallbackMsg = { id: runId, content: '(no trigger)', sender_type: 'user', created_at: new Date().toISOString(), metadata: {} as Record<string, unknown> }
    let triggerMsg = fallbackMsg
    if (runRow.trigger_msg_id) {
      const { data: tm } = await supabase
        .from('messages')
        .select('id, content, sender_type, created_at, metadata')
        .eq('id', runRow.trigger_msg_id)
        .single()
      if (tm) triggerMsg = tm as typeof triggerMsg
    }

    const agentInfo = runRow.agents
    if (!agentInfo) throw new Error('Agent info missing from run row')

    // f. Build ContextPacketV1
    const packet = await buildContextPacket({
      supabase,
      run: { id: runId, room_id: runRow.room_id, round_index: runRow.round_index },
      agentInfo,
      triggerMsg,
    })

    // g. Run adapter, collect final response
    const adapter = getAdapter(agentInfo.adapter_type ?? 'mock')
    const controller = new AbortController()
    let finalContent = ''

    for await (const event of adapter.run(packet, controller.signal)) {
      if (event.type === 'final_response') {
        finalContent = event.response.content
      } else if (event.type === 'error') {
        throw new Error(event.message)
      } else if (event.type === 'tool_call_requested') {
        const requiresApproval = event.requires_approval

        const { data: tc } = await supabase.from('tool_calls').insert({
          room_id: runRow.room_id,
          run_id: runRow.id,
          agent_id: agentInfo.id,
          tool_name: event.tool_name,
          tool_category: event.tool_category ?? null,
          input_args: event.arguments,
          status: requiresApproval ? 'waiting_approval' : 'queued',
          requires_approval: requiresApproval,
        }).select().single()

        if (tc) {
          const commandArg = (event.arguments['command'] as string | undefined) ?? ''
          if (isDeniedCommand(commandArg)) {
            await supabase.from('tool_calls').update({
              status: 'denied',
              error: 'Command blocked by denylist',
            }).eq('id', tc.id)
            log('warn', 'tool.denied', { run_id: runId, tool_name: event.tool_name, reason: 'denylist' })
            throw new Error('Command blocked by denylist')
          }
        }

        if (tc && requiresApproval) {
          let finalStatus = 'failed'
          log('info', 'tool.approval.waiting', { run_id: runId, tool_name: event.tool_name })
          for (let i = 0; i < 15; i++) {
            await new Promise<void>((r) => setTimeout(r, 2000))
            const { data: updated } = await supabase.from('tool_calls').select('status').eq('id', tc.id).single()
            if (updated?.status === 'approved') { finalStatus = 'approved'; break }
            if (updated?.status === 'denied') { finalStatus = 'denied'; break }
          }
          if (finalStatus === 'approved') {
            log('info', 'tool.approval.received', { run_id: runId, tool_name: event.tool_name, approved: true })
            await supabase.from('tool_calls').update({ status: 'running' }).eq('id', tc.id)
            const result = { ok: true, stdout: 'approved' }
            await supabase.from('tool_calls').update({ status: 'succeeded', output: redact(JSON.stringify(result)) }).eq('id', tc.id)
          } else {
            log(finalStatus === 'denied' ? 'info' : 'warn', finalStatus === 'denied' ? 'tool.approval.received' : 'tool.approval.timeout', {
              run_id: runId,
              tool_name: event.tool_name,
              ...(finalStatus === 'denied' ? { approved: false } : {}),
            })
            await supabase.from('tool_calls').update({
              status: finalStatus === 'denied' ? 'denied' : 'failed',
              error: finalStatus === 'denied' ? null : 'approval timeout',
            }).eq('id', tc.id)
          }
        } else if (tc) {
          const result = { ok: true, stdout: 'executed' }
          await supabase.from('tool_calls').update({ status: 'succeeded', output: redact(JSON.stringify(result)) }).eq('id', tc.id)
        }
      }
    }

    if (!finalContent) throw new Error('Adapter produced no final_response')

    // h. Insert agent reply into messages
    const replyContent = redact(sanitizeAgentOutput(finalContent))
    const isConclusion = conclusionDetected(replyContent)
    const hallucination = detectHallucination(replyContent)
    log('info', 'hallucination.check', {
      run_id: runId,
      flagged: hallucination.flagged,
      confidence: hallucination.confidence,
    })
    const metadata = {
      agent_loop: {
        is_conclusion: isConclusion,
        round_index: runRow.round_index,
      },
      hallucination: {
        flagged: hallucination.flagged,
        confidence: hallucination.confidence,
        reasons: hallucination.reasons,
        checked_at: new Date().toISOString(),
      },
    }
    const { data: insertedMessage, error: insertMessageError } = await supabase.from('messages').insert({
      room_id: runRow.room_id,
      sender_type: 'agent',
      sender_agent_id: runRow.agent_id,
      content: replyContent,
      content_type: 'text',
      round_index: runRow.round_index,
      metadata,
    }).select('id').single()

    if (insertMessageError || !insertedMessage) {
      throw new Error(insertMessageError?.message ?? 'Failed to insert agent reply')
    }

    // i. Mark run completed
    await supabase
      .from('agent_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', runId)
    await maybeScheduleDiscussionContinuation({
      supabase,
      roomId: runRow.room_id,
      currentRoundIndex: runRow.round_index,
      triggerMessage: triggerMsg,
    })
    log('info', 'run.complete', { run_id: runId, duration_ms: Date.now() - startedAt })

  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err))
    await supabase
      .from('agent_runs')
      .update({ status: 'failed', error_message: message })
      .eq('id', runId)
    log('error', 'run.failed', { run_id: runId, error: message })
    throw err
  }
}
