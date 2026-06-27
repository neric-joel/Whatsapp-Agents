import { describe, expect, it } from 'vitest'

import { requireRoomAdmin, requireRoomMember, requireRoomOwner } from '../permissions'

// Local single-user app: the one user owns every room, so the RBAC gates are
// no-ops that always pass. (Re-introducing multi-user means filling these in and
// restoring rejection tests here.)
describe('room permission gates (local single-user)', () => {
  it('requireRoomMember always resolves', async () => {
    await expect(requireRoomMember('room-1', 'user-1')).resolves.toBeUndefined()
  })
  it('requireRoomOwner always resolves', async () => {
    await expect(requireRoomOwner('room-1', 'user-1')).resolves.toBeUndefined()
  })
  it('requireRoomAdmin always resolves', async () => {
    await expect(requireRoomAdmin('room-1', 'user-1')).resolves.toBeUndefined()
  })
})
