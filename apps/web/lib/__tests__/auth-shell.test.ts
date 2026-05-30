import { describe, expect, it } from 'vitest'

import { getAuthShellState } from '../auth-shell'

describe('getAuthShellState', () => {
  it('renders auth content publicly when the visitor is signed out', () => {
    expect(getAuthShellState({ pathname: '/auth', loading: false, hasUser: false })).toEqual({
      render: 'public',
      redirectTo: null,
    })
  })

  it('renders auth content without waiting for session loading', () => {
    expect(getAuthShellState({ pathname: '/auth', loading: true, hasUser: false })).toEqual({
      render: 'public',
      redirectTo: null,
    })
  })

  it('hides protected content and redirects signed-out visitors to auth', () => {
    expect(
      getAuthShellState({ pathname: '/rooms/room-1', loading: false, hasUser: false }),
    ).toEqual({
      render: 'none',
      redirectTo: '/auth',
    })
  })
})
