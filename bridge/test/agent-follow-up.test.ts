import assert from 'node:assert/strict'
import { test } from 'node:test'

import { maybeScheduleAgentMentionFollowUps } from '../src/lib/agent-follow-up.js'

type QueryResult = { data?: unknown; error?: unknown }

interface StubOptions {
  room?: {
    allow_agent_to_agent?: boolean
    max_agent_rounds?: number
    discussion_mode?: 'independent' | 'tag_turns'
  }
  existingRuns?: Array<{ agent_id: string }>
}

function createSupabaseStub(options: StubOptions = {}) {
  const inserted: unknown[] = []
  const room = {
    allow_agent_to_agent: true,
    max_agent_rounds: 4,
    discussion_mode: 'tag_turns' as const,
    ...(options.room ?? {}),
  }

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
                  return Promise.resolve({ data: room })
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
                  resolve({ data: options.existingRuns ?? [] })
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

test('agent reply in independent mode with @mention creates no follow-up', async () => {
  const supabase = createSupabaseStub()

  const targets = await maybeScheduleAgentMentionFollowUps({
    supabase: supabase.client as never,
    currentRun: {
      id: 'run-1',
      discussion_mode: 'independent',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, [])
  assert.deepEqual(supabase.inserted, [])
})

test('current run tag_turns mode allows follow-up even if the room default is independent', async () => {
  const supabase = createSupabaseStub({ room: { discussion_mode: 'independent' } })

  const targets = await maybeScheduleAgentMentionFollowUps({
    supabase: supabase.client as never,
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, ['reviewer'])
  assert.equal(supabase.inserted.length, 1)
})

test('agent reply in tag_turns mode with @mention creates exactly the mentioned follow-up run', async () => {
  const supabase = createSupabaseStub()

  const targets = await maybeScheduleAgentMentionFollowUps({
    supabase: supabase.client as never,
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, ['reviewer'])
  assert.deepEqual(supabase.inserted, [
    {
      room_id: 'room-1',
      agent_id: 'reviewer',
      trigger_msg_id: 'message-1',
      status: 'queued',
      round_index: 1,
      discussion_mode: 'tag_turns',
      deliberation_depth: 1,
      deliberation_root_id: 'run-1',
    },
  ])
})

test('agent reply with no mention creates no follow-up', async () => {
  const supabase = createSupabaseStub()

  const targets = await maybeScheduleAgentMentionFollowUps({
    supabase: supabase.client as never,
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: 'I think we have a conclusion.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, [])
  assert.deepEqual(supabase.inserted, [])
})

test('agent reply at max deliberation depth creates no follow-up', async () => {
  const supabase = createSupabaseStub({ room: { max_agent_rounds: 2 } })

  const targets = await maybeScheduleAgentMentionFollowUps({
    supabase: supabase.client as never,
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 1,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 1,
  })

  assert.deepEqual(targets, [])
  assert.deepEqual(supabase.inserted, [])
})

test('follow-up runs propagate existing deliberation root and increment depth', async () => {
  const supabase = createSupabaseStub()

  await maybeScheduleAgentMentionFollowUps({
    supabase: supabase.client as never,
    currentRun: {
      id: 'run-2',
      discussion_mode: 'tag_turns',
      deliberation_depth: 2,
      deliberation_root_id: 'root-run',
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-2',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 2,
  })

  assert.deepEqual(supabase.inserted, [
    {
      room_id: 'room-1',
      agent_id: 'reviewer',
      trigger_msg_id: 'message-2',
      status: 'queued',
      round_index: 3,
      discussion_mode: 'tag_turns',
      deliberation_depth: 3,
      deliberation_root_id: 'root-run',
    },
  ])
})

test('duplicate mentions do not create duplicate follow-up runs', async () => {
  const supabase = createSupabaseStub()

  const targets = await maybeScheduleAgentMentionFollowUps({
    supabase: supabase.client as never,
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer @reviewer @Reviewer please challenge this.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, ['reviewer'])
  assert.equal(supabase.inserted.length, 1)
})
