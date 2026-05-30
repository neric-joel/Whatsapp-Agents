import type { ApiOk } from '@agentroom/shared'
import { NextResponse } from 'next/server'

export function ok<T>(data: T, status = 200): NextResponse<ApiOk<T>> {
  return NextResponse.json({ ok: true, data }, { status })
}
