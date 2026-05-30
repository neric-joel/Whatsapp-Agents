export function getApiErrorMessage(payload: unknown, fallback = 'Request failed') {
  if (!payload || typeof payload !== 'object') return fallback

  const error = (payload as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return fallback

  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.length > 0 ? message : fallback
}
