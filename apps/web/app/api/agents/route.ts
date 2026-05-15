import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api-error'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { data: { user }, error: authErr } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('agents')
    .select('id, name, slug, provider, adapter_type, is_active')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) return apiError('INTERNAL_ERROR', error.message, 500)

  return apiSuccess(data ?? [])
}
