import { apiError, apiSuccess } from '@/lib/api-error'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('agents')
    .select('id, slug, name')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) return apiError('INTERNAL_ERROR', error.message, 500)

  return apiSuccess(data ?? [])
}
