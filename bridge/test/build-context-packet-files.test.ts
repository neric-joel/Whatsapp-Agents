import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { buildContextPacket } from '../src/context/build-context-packet.js'
import { freshTestDb, seedFile, seedMessage, seedRoom, type TestDb } from './helpers/test-db.js'

// build-context-packet.ts resolves `metadata.file_ids` (set by the caller, e.g. a message
// POST) into file rows with a bare `WHERE id IN (...)` — no room_id predicate. Rooms are not
// a security boundary in this single-user app, but a message in room A should still only be
// able to pull room A's own files: `metadata.file_ids` naming a file that actually lives in
// room B must not leak room B's filename/extracted_text into room A's context packet.

const agentInfo = {
  id: 'agent-1',
  name: 'Helper',
  slug: 'helper',
  system_prompt: null,
  provider: 'mock',
}

let h: TestDb
beforeEach(() => {
  h = freshTestDb()
})

afterEach(() => {
  h.cleanup()
})

test('file lookup is room-scoped: a file_id from another room is excluded', async () => {
  seedRoom(h.db, {
    id: 'room-A',
    name: 'Room A',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
  })
  seedRoom(h.db, {
    id: 'room-B',
    name: 'Room B',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
  })

  const ownFileId = seedFile(h.db, 'room-A', {
    filename: 'own-file.txt',
    extracted_text: 'own room content',
  })
  const otherRoomFileId = seedFile(h.db, 'room-B', {
    filename: 'secret-room-b-file.txt',
    extracted_text: 'room B private content',
  })

  // A message in room A whose metadata references both its own file and room B's file —
  // stripServerOwnedMetadata does not filter file_ids, so this is attacker-reachable via a
  // crafted POST /api/rooms/room-A/messages body.
  seedMessage(h.db, 'room-A', {
    id: 'msg-trigger',
    content: 'see attachments',
    metadata: JSON.stringify({ file_ids: [ownFileId, otherRoomFileId] }),
    created_at: '2026-05-31T12:00:00.000Z',
  })

  const run = {
    id: 'run-1',
    room_id: 'room-A',
    round_index: 0,
    discussion_mode: 'independent' as const,
    deliberation_depth: 0,
    deliberation_root_id: null,
  }
  const triggerMsg = {
    id: 'msg-trigger',
    content: 'see attachments',
    sender_type: 'user',
    sender_user_id: 'user-1',
    created_at: '2026-05-31T12:00:00.000Z',
    metadata: { file_ids: [ownFileId, otherRoomFileId] },
  }

  const packet = await buildContextPacket({ run, agentInfo, triggerMsg })

  const fileIds = packet.files.map((f) => f.id)
  assert.ok(fileIds.includes(ownFileId), "room A's own file must still be included")
  assert.ok(
    !fileIds.includes(otherRoomFileId),
    "a file_id belonging to another room must not be pulled into this room's context packet",
  )
  assert.ok(
    !packet.files.some((f) => f.filename === 'secret-room-b-file.txt'),
    "room B's filename must not leak into room A's context",
  )
})
