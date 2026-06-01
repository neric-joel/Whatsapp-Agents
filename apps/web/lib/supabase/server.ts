import { createServerClient, type SetAllCookies } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

import { getBearerToken } from '@/lib/api-auth'

export function createSupabaseServerClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // setAll is called from a Server Component where the cookie store
            // is read-only; safe to ignore since middleware refreshes sessions.
          }
        },
      },
    },
  )
}

export function createSupabaseServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export function getAuthenticatedUser(req: { headers: Headers }) {
  const supabaseUser = createSupabaseServerClient()
  const bearerToken = getBearerToken(req)

  return supabaseUser.auth.getUser(bearerToken ?? undefined)
}
