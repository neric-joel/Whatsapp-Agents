import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isForbiddenCrossOrigin } from '@/lib/origin'

/**
 * Local single-user app: there is no login, so the middleware no longer does auth
 * or touches Supabase. It keeps ONE defense — rejecting cross-origin cookie-style
 * mutations to the API — so a random web page you happen to visit can't drive your
 * local AgentRoom on localhost. Individual routes also assert same-origin (defense
 * in depth).
 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api') && isForbiddenCrossOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'Cross-origin request rejected' } },
      { status: 403 },
    )
  }
  return NextResponse.next()
}

export const config = {
  // Only the API needs the cross-origin guard now; page routes are open (local app).
  matcher: ['/api/:path*'],
}
