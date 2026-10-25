/** Liveness for container/ECS health checks: GET /shop/api/health */
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ status: 'ok', zone: 'storefront' });
}
