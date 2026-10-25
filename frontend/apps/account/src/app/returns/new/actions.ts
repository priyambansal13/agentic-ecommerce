'use server';
import { send } from '@ac/bff';
import { ReturnInputSchema, ReturnViewSchema } from '@ac/contracts';
import { REJECTION_TEXT } from '../../../lib/return-text';

export type ReturnFormState = { error?: string; returnId?: string; values?: Record<string, string> };

/** Create the return (POST /returns). The photo, if any, is uploaded by the browser right after, via a route handler. */
export async function createReturn(_: ReturnFormState, fd: FormData): Promise<ReturnFormState> {
  const values = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  const productIds = fd.getAll('item').map(String);
  const lines = productIds.map((productId) => ({ productId, qty: Number(fd.get(`qty_${productId}`) ?? 1) }));
  const parsed = ReturnInputSchema.safeParse({
    orderId: values.orderId,
    lines,
    reasonCode: values.reasonCode,
    buyerText: values.buyerText ?? '',
    preferred: values.preferred === 'REPLACEMENT' ? 'REPLACEMENT' : 'REFUND',
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = String(first?.path[0] ?? '');
    const msg =
      where === 'lines' ? 'Choose at least one item to return.'
      : where === 'reasonCode' ? 'Choose a reason.'
      : where === 'buyerText' ? 'Describe the problem in at least 10 characters.'
      : 'Please check the form.';
    return { error: msg, values };
  }
  const r = await send('POST', '/api/returns/v1/returns', parsed.data, { schema: ReturnViewSchema, idempotencyKey: `return-${values.attempt ?? ''}`, timeoutMs: 10000 });
  if (r.ok) return { returnId: r.data.returnId };
  const text = (r.code && REJECTION_TEXT[r.code]) ?? (r.status === 404 || r.status === 503 ? 'Returns can’t be started right now. Please try again in a few minutes.' : r.error);
  return { error: text, values };
}
