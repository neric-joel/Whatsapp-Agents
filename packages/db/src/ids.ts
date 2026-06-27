import { randomUUID } from 'node:crypto'

/** Generate a v4 UUID. Postgres did this with gen_random_uuid(); we do it in JS. */
export const newId = (): string => randomUUID()

/** Current time as an ISO-8601 UTC string (lexicographically sortable). */
export const nowIso = (): string => new Date().toISOString()
