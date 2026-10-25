import { proxyBinary } from '@ac/bff';
import { UUID } from '../../../../../lib/returns';

/** Return evidence photo (owner only — the returns service checks); streamed with the buyer's token. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response(null, { status: 400 });
  return proxyBinary(`/api/returns/v1/evidence/${id}/image`);
}
