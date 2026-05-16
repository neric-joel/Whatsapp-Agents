type AuthShellInput = {
  pathname: string
  loading: boolean
  hasUser: boolean
}

type AuthShellState = {
  render: 'none' | 'public' | 'app'
  redirectTo: string | null
}

export function getAuthShellState({ pathname, loading, hasUser }: AuthShellInput): AuthShellState {
  if (pathname === '/auth') {
    return !loading && hasUser
      ? { render: 'none', redirectTo: '/' }
      : { render: 'public', redirectTo: null }
  }

  if (loading) return { render: 'none', redirectTo: null }

  if (!hasUser) return { render: 'none', redirectTo: '/auth' }

  return { render: 'app', redirectTo: null }
}
