import type { SupabaseClient } from '@supabase/supabase-js'

import { apiError } from './api-error'

async function getRoomMembership(
  supabase: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<{ isMember: boolean; isAdmin: boolean; isOwner: boolean; role: string | null }> {
  const { data } = await supabase
    .from('room_members')
    .select('role')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return { isMember: false, isAdmin: false, isOwner: false, role: null }
  const role = data.role as string
  return {
    isMember: true,
    isAdmin: role === 'admin' || role === 'owner',
    isOwner: role === 'owner',
    role,
  }
}

export async function requireRoomMember(
  supabase: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<void> {
  const { isMember } = await getRoomMembership(supabase, roomId, userId)
  if (!isMember) throw apiError('FORBIDDEN', 'Not a room member', 403)
}

export async function requireRoomOwner(
  supabase: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<void> {
  const { isOwner } = await getRoomMembership(supabase, roomId, userId)
  if (!isOwner) throw apiError('FORBIDDEN', 'Owner required', 403)
}

/**
 * Admin+ gate (admin or owner). Used by RBAC-gated commands (`/reset`) and by
 * user-created-agent management — server-side enforcement, never UI-only.
 */
export async function requireRoomAdmin(
  supabase: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<void> {
  const { isMember, isAdmin } = await getRoomMembership(supabase, roomId, userId)
  if (!isMember) throw apiError('FORBIDDEN', 'Not a room member', 403)
  if (!isAdmin) throw apiError('FORBIDDEN', 'Admin required', 403)
}
