import { proxyBinary } from '@ac/bff';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Return evidence photo for staff (support, finance, admin — the returns service checks the role). */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response(null, { status: 400 });
  return proxyBinary(`/api/returns/v1/evidence/${id}/image`);
}
