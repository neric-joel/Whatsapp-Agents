import { NextResponse } from 'next/server'

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status })
}

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status })
}
