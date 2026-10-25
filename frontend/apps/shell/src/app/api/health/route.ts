/** Liveness for container/ECS health checks: GET /api/health */
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ status: 'ok', zone: 'shell' });
}
