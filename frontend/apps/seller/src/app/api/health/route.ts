/** Liveness for container/ECS health checks: GET /seller/api/health */
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ status: 'ok', zone: 'seller' });
}
