import { type CookieOptions, createServerClient } from '@supabase/ssr'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isForbiddenCrossOrigin } from '@/lib/api-security'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api')

  // 1. CSRF defense: reject cross-origin cookie-authed mutations to the API.
  //    (Defense-in-depth; individual routes also call assertSameOrigin.)
  if (isApi && isForbiddenCrossOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: { code: 'FORBIDDEN', message: 'Cross-origin request rejected' } },
      { status: 403 },
    )
  }

  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: request.headers } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options ?? {}),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // 2. Fail-closed: send unauthenticated page requests to the login page.
  //    API routes enforce their own 401s, so we don't redirect those.
  if (!isApi && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    url.search = ''
    if (pathname && pathname !== '/') url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  // Anchor the `auth` exclusion to the exact segment so only `/auth` and
  // `/auth/*` are skipped (not e.g. `/authxyz`). Phase-1 review L-1.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth(?:/|$)).*)'],
}
