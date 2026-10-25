/** Liveness for container/ECS health checks: GET /admin/api/health */
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ status: 'ok', zone: 'admin' });
}
