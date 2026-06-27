'use client'

/**
 * Local single-user app — there are no accounts and no login.
 *
 * This hook is kept as a stub so the existing shell components (sidebar, header,
 * settings) compile and render unchanged: the app always has "a user", never
 * shows a loading gate, and never redirects to a login page. `signOut` is a no-op
 * (there's nothing to sign out of locally).
 */
export function useAuth() {
  return {
    user: { id: 'local-user' } as { id: string; email?: string },
    loading: false,
    signOut: async () => {},
  }
}
