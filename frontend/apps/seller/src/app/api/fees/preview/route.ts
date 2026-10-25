import { send } from '@ac/bff';
import { FeeBreakdownSchema, FeePreviewInputSchema } from '@ac/contracts';

/** Browser → zone → payment service POST /v1/fees/preview (active fee schedule). Validates before forwarding. */
export async function POST(req: Request) {
  const body = FeePreviewInputSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: 'invalid preview request' }, { status: 400 });
  const r = await send('POST', '/api/payment/v1/fees/preview', body.data, { schema: FeeBreakdownSchema, timeoutMs: 3000 });
  return r.ok ? Response.json(r.data) : Response.json({ error: r.error }, { status: r.status });
}
