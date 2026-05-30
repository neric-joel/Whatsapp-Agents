import { apiSuccess } from '@/lib/api-error'

export async function GET() {
  return apiSuccess({ service: 'agentroom-web' })
}
