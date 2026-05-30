import type { ApiError, ApiOk } from '@agentroom/shared'
import { NextResponse } from 'next/server'

export function ok<T>(data: T, status = 200): NextResponse<ApiOk<T>> {
  return NextResponse.json({ ok: true, data }, { status })
}

export function err(error: string, status = 400): NextResponse<ApiError> {
  return NextResponse.json({ ok: false, error }, { status })
}
