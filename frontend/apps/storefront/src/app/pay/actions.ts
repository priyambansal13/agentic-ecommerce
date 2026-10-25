'use server';
import { send } from '@ac/bff';
import { TestPayInputSchema } from '@ac/contracts';
import { randomUUID } from 'node:crypto';
import { UUID } from '../../lib/shop';

export interface PayState {
  submitted?: boolean;
  error?: string;
  nonce?: string;
}

/** Submit a TEST card to the payment service; the result arrives by webhook, so the client then polls. */
export async function payWithTestCard(_: PayState, fd: FormData): Promise<PayState> {
  const paymentId = String(fd.get('paymentId') ?? '');
  if (!UUID.test(paymentId)) return { error: 'Unknown payment.' };
  const input = TestPayInputSchema.safeParse({
    cardNumber: String(fd.get('cardNumber') ?? '').trim(),
    expiry: String(fd.get('expiry') ?? '').trim(),
    cvc: String(fd.get('cvc') ?? '').trim(),
    name: String(fd.get('name') ?? '').trim(),
  });
  if (!input.success) return { error: input.error.issues.map((i) => (i.path[0] === 'cardNumber' ? 'Enter a 16-digit card number' : i.path[0] === 'expiry' ? 'Expiry must look like MM/YY' : i.path[0] === 'cvc' ? 'CVC is 3 or 4 digits' : 'Enter the name on the card')).join(' · ') };
  const r = await send('POST', `/api/payment/v1/payments/${paymentId}/testpay`, input.data, { idempotencyKey: String(fd.get('idem') || randomUUID()), timeoutMs: 10000 });
  if (!r.ok) return { error: r.status === 409 ? 'This payment is no longer open — refresh the page.' : r.error };
  return { submitted: true, nonce: randomUUID() };
}
