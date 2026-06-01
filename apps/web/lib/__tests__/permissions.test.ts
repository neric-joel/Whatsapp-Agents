import { describe, expect, it } from 'vitest'

import { requireRoomAdmin } from '../permissions'

// Minimal stub of the membership query chain:
//   supabase.from('room_members').select('role').eq(...).eq(...).maybeSingle()
function clientWithRole(role: string | null) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return { data: role === null ? null : { role }, error: null }
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('requireRoomAdmin (server-side RBAC enforcement)', () => {
  it('rejects a plain member with 403 (not just hidden in the UI)', async () => {
    let thrown: unknown
    try {
      await requireRoomAdmin(clientWithRole('member'), 'room-1', 'user-1')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Response)
    expect((thrown as Response).status).toBe(403)
  })

  it('rejects a non-member with 403', async () => {
    let thrown: unknown
    try {
      await requireRoomAdmin(clientWithRole(null), 'room-1', 'user-1')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Response)
    expect((thrown as Response).status).toBe(403)
  })

  it('allows an admin', async () => {
    await expect(
      requireRoomAdmin(clientWithRole('admin'), 'room-1', 'user-1'),
    ).resolves.toBeUndefined()
  })

  it('allows an owner', async () => {
    await expect(
      requireRoomAdmin(clientWithRole('owner'), 'room-1', 'user-1'),
    ).resolves.toBeUndefined()
  })
})
