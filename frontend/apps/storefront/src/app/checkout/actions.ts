'use server';
import { getSession, seal, send } from '@ac/bff';
import { AddressSchema, CheckoutRejectionSchema, CheckoutResultSchema } from '@ac/contracts';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { ADDRESS_COOKIE, shopUrl } from '../../lib/shop';

export interface CheckoutState {
  error?: string;
  code?: string;
  offerIds?: string[];
  issues?: Record<string, string>;
  values?: Record<string, string>;
  /** a fresh Idempotency-Key after a rejection (the next attempt is a different request) */
  idem?: string;
}

const FIELDS = ['name', 'line1', 'line2', 'city', 'state', 'pincode', 'phone'] as const;

/** "Place your order and pay": POST /checkout (order saga) → pay page. Same Idempotency-Key on double submit. */
export async function placeOrder(_: CheckoutState, fd: FormData): Promise<CheckoutState> {
  const session = await getSession();
  if (!session || session.realm !== 'customers') return { error: 'Your session expired — sign in again to place the order.', code: 'AUTH' };
  const values = Object.fromEntries(FIELDS.map((k) => [k, String(fd.get(k) ?? '').trim()])) as Record<string, string>;
  const addr = AddressSchema.safeParse({ ...values, line2: values.line2 || undefined });
  if (!addr.success) return { values, issues: Object.fromEntries(addr.error.issues.map((i) => [String(i.path[0]), i.message])), error: 'Check the delivery address.' };
  const idem = String(fd.get('idem') ?? '') || randomUUID();
  const expectedTotalMinor = Number(fd.get('expectedTotalMinor'));
  const r = await send('POST', '/api/order/v1/checkout', { shippingAddress: addr.data, provider: 'testpay', expectedTotalMinor }, { schema: CheckoutResultSchema, idempotencyKey: idem, timeoutMs: 12000 });
  if (!r.ok) {
    const fresh = randomUUID();
    if (r.status === 400 && r.issues?.length) return { values, idem: fresh, error: r.issues.map((i) => i.message).join('; ') };
    const code = r.code ?? (r.status === 503 ? 'DEPENDENCY_UNAVAILABLE' : undefined);
    const rej = CheckoutRejectionSchema.safeParse(r.body);
    revalidatePath('/checkout');
    return { values, idem: fresh, code: rej.success ? rej.data.code : code, offerIds: rej.success ? rej.data.offerIds : [], error: rej.success ? rej.data.message : r.error };
  }
  // remember the address for next time (encrypted, httpOnly — never in browser storage)
  (await cookies()).set(ADDRESS_COOKIE, await seal(addr.data, 180 * 86400), { httpOnly: true, sameSite: 'lax', path: '/shop', maxAge: 180 * 86400, secure: shopUrl('').startsWith('https://') });
  revalidatePath('/', 'layout');
  redirect(shopUrl(`/pay/${r.data.payment.paymentId}`));
}
