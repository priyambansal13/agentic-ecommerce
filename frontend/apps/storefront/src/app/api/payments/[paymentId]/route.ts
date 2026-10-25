import { load } from '@ac/bff';
import { PaymentViewSchema } from '@ac/contracts';
import { UUID } from '../../../../lib/shop';

/** Poll target for the pay page (the buyer's token stays server-side). */
export async function GET(_: Request, ctx: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await ctx.params;
  if (!UUID.test(paymentId)) return Response.json({ error: 'bad id' }, { status: 400 });
  const r = await load(PaymentViewSchema, `/api/payment/v1/payments/${paymentId}`);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { 'cache-control': 'no-store' } });
  const p = r.data;
  return Response.json({ status: p.status, failureReason: p.failureReason, orderId: p.orderId, expiresAt: p.expiresAt }, { headers: { 'cache-control': 'no-store' } });
}
