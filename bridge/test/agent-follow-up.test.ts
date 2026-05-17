import assert from 'node:assert/strict'
import { test } from 'node:test'

import { maybeScheduleAgentMentionFollowUps } from '../src/lib/agent-follow-up.js'

type QueryResult = { data?: unknown; error?: unknown }

function createSupabaseStub() {
  const inserted: unknown[] = []

  return {
    inserted,
    client: {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return this
              },
              single(): Promise<QueryResult> {
                if (table === 'rooms') {
                  return Promise.resolve({ data: { allow_agent_to_agent: true, max_agent_rounds: 4 } })
                }
                return Promise.resolve({ data: null })
              },
              then(resolve: (value: QueryResult) => void) {
                if (table === 'room_members') {
                  resolve({
                    data: [
                      {
                        agent_id: 'source',
                        muted: false,
                        reply_enabled: true,
                        agents: { id: 'source', name: 'Codex Builder', slug: 'codex_builder', is_active: true },
                      },
                      {
                        agent_id: 'reviewer',
                        muted: false,
                        reply_enabled: true,
                        agents: { id: 'reviewer', name: 'Reviewer', slug: 'reviewer', is_active: true },
                      },
                    ],
                  })
                  return
                }
                if (table === 'agent_runs') {
                  resolve({ data: [] })
                  return
                }
                resolve({ data: [] })
              },
            }
          },
          insert(rows: unknown[]) {
            inserted.push(...rows)
            return Promise.resolve({ data: rows, error: null })
          },
        }
      },
    },
  }
}

test('schedules next-round run for explicitly mentioned agent replies', async () => {
  const supabase = createSupabaseStub()

  const targets = await maybeScheduleAgentMentionFollowUps({
    supabase: supabase.client as never,
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 0,
    isConclusion: false,
  })

  assert.deepEqual(targets, ['reviewer'])
  assert.deepEqual(supabase.inserted, [
    {
      room_id: 'room-1',
      agent_id: 'reviewer',
      trigger_msg_id: 'message-1',
      status: 'queued',
      round_index: 1,
    },
  ])
})
