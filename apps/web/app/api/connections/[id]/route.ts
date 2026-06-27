import { deleteProfile, getProfile, probeCommand } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, internalError } from '@/lib/api-security'

export const runtime = 'nodejs'

/** Health-check a single saved profile on demand (re-probe its binary). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = getProfile(id)
  if (!profile) return apiError('NOT_FOUND', 'CLI profile not found', 404)
  try {
    const probe = await probeCommand(profile.bin)
    return apiSuccess({ ...profile, probe })
  } catch (e) {
    return internalError('connection verify', e)
  }
}

/** Remove a connected CLI profile from config.json. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf
  const { id } = await params
  try {
    const removed = deleteProfile(id)
    if (!removed) return apiError('NOT_FOUND', 'CLI profile not found', 404)
    return apiSuccess({ id, removed: true })
  } catch (e) {
    return internalError('connection delete', e)
  }
}
