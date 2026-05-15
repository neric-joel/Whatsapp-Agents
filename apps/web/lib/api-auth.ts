export function getBearerToken(req: { headers: Headers } | null | undefined) {
  const authorization = req?.headers.get('authorization')
  if (!authorization) return null

  const [scheme, token] = authorization.trim().split(/\s+/, 2)
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null

  return token
}
