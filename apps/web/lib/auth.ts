import { LOCAL_USER_ID } from '@agentroom/db'

/**
 * Local single-user app — there are no accounts. A fixed id is "the user" and owns
 * everything. Replaces the old Supabase auth.
 */
export const CURRENT_USER_ID = LOCAL_USER_ID

/**
 * Returns the one local user, shaped like the old Supabase `auth.getUser()` result
 * so existing route code keeps working unchanged:
 *   const { data: { user }, error } = await getAuthenticatedUser(req)
 *   if (error || !user) ...   // never triggers locally
 */
export function getAuthenticatedUser(_req?: { headers: Headers }) {
  return Promise.resolve({
    data: { user: { id: LOCAL_USER_ID } },
    error: null as Error | null,
  })
}
