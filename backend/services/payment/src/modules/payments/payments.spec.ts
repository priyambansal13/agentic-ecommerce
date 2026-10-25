import { describe, expect, it, vi } from 'vitest';
import { LAUNCH_SCHEDULE } from '../fees/fee-math.js';
import { checkCard, luhn } from './cards.js';
import { capturePostings, feePostings, feeRows, isBalanced, refundPostings, type PaymentLine } from './ledger.js';
import { StripeProvider, TestpayProvider } from './providers.js';
import { sign, verify } from './signature.js';

const SECRET = 'whsec_test_secret';
const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', data: { intentId: 'tp_1', amountMinor: 1000 } });

describe('webhook signatures', () => {
  const now = 1_800_000_000;
  it('accepts a valid signature', () => expect(verify(SECRET, body, sign(SECRET, body, now), now)).toEqual({ ok: true }));
  it('rejects a tampered body', () => expect(verify(SECRET, body.replace('1000', '1'), sign(SECRET, body, now), now)).toMatchObject({ ok: false, reason: 'BAD_SIGNATURE' }));
  it('rejects the wrong secret', () => expect(verify('other', body, sign(SECRET, body, now), now)).toMatchObject({ ok: false, reason: 'BAD_SIGNATURE' }));
  it('rejects a replay outside the tolerance window', () => expect(verify(SECRET, body, sign(SECRET, body, now - 301), now)).toMatchObject({ ok: false, reason: 'TIMESTAMP_OUT_OF_RANGE' }));
  it('rejects missing / malformed headers', () => {
    expect(verify(SECRET, body, undefined, now)).toMatchObject({ reason: 'MISSING' });
    expect(verify(SECRET, body, 'garbage', now)).toMatchObject({ reason: 'MALFORMED' });
  });
  it('accepts any matching v1 (secret rotation)', () => {
    const good = sign(SECRET, body, now);
    expect(verify(SECRET, body, `t=${now},v1=${'0'.repeat(64)},${good.split(',')[1]}`, now)).toEqual({ ok: true });
  });
});

describe('testpay cards', () => {
  const now = new Date('2026-10-24T00:00:00Z');
  it('luhn', () => {
    expect(luhn('4242424242424242')).toBe(true);
    expect(luhn('4242424242424241')).toBe(false);
  });
  it('maps the documented test cards', () => {
    expect(checkCard('4242 4242 4242 4242', '12/30', now)).toMatchObject({ ok: true, outcome: 'SUCCEEDED', brand: 'visa', last4: '4242' });
    expect(checkCard('4000 0000 0000 0002', '12/30', now)).toMatchObject({ ok: true, outcome: 'DECLINED', last4: '0002' });
    expect(checkCard('4000000000009995', '12/30', now)).toMatchObject({ ok: true, outcome: 'INSUFFICIENT_FUNDS' });
  });
  it('rejects invalid numbers and expired cards', () => {
    expect(checkCard('4242 4242 4242 4241', '12/30', now)).toMatchObject({ ok: false, error: 'INVALID_NUMBER' });
    expect(checkCard('4242 4242 4242 4242', '09/26', now)).toMatchObject({ ok: false, error: 'EXPIRED' });
    expect(checkCard('4242 4242 4242 4242', '10/26', now)).toMatchObject({ ok: true }); // valid through end of month
  });
  it('never exposes more than the last 4 digits', () => expect(Object.values(checkCard('4242424242424242', '12/30', now)).join('|')).not.toContain('424242424242'));
});

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const lines: PaymentLine[] = [
  { sellerId: A, productId: null, category: 'fashion', qty: 2, unitPriceMinor: 129_900 },
  { sellerId: B, productId: null, category: 'electronics', qty: 1, unitPriceMinor: 199_900 },
];
const total = 2 * 129_900 + 199_900 + 4_000; // + shipping

describe('ledger', () => {
  it('capture credits each seller its gross and shipping to the platform', () => {
    const p = capturePostings(total, lines);
    expect(isBalanced(p)).toBe(true);
    expect(p.find((x) => x.account === `seller:${A}:payable`)?.credit).toBe(259_800);
    expect(p.find((x) => x.account === 'platform:shipping')?.credit).toBe(4_000);
  });
  it('refuses lines above the captured amount', () => expect(() => capturePostings(1, lines)).toThrow());
  it('fee transactions per seller are balanced and reverse exactly', () => {
    const rows = feeRows(LAUNCH_SCHEDULE, lines);
    const fwd = feePostings(rows);
    const rev = feePostings(rows, true);
    expect(fwd.size).toBe(2);
    for (const [seller, p] of fwd) {
      expect(isBalanced(p)).toBe(true);
      const r = rev.get(seller)!;
      p.forEach((x, i) => expect([r[i].debit, r[i].credit]).toEqual([x.credit, x.debit]));
    }
    // ₹1,299 fashion ×2: referral 17 % = 44,166 · closing ₹40 ×2 · payment 2 % = 5,196 · GST 18 %
    expect(rows[0]).toMatchObject({ saleMinor: 259_800, referralMinor: 44_166, closingMinor: 8_000, paymentMinor: 5_196 });
  });
  it('full refund mirrors the capture; partial refunds stay balanced to the paisa', () => {
    const full = refundPostings(total, total, lines);
    expect(isBalanced(full)).toBe(true);
    expect(full.find((x) => x.account === `seller:${A}:payable`)?.debit).toBe(259_800);
    for (const amt of [1, 333, 99_999, total - 1]) {
      const p = refundPostings(amt, total, lines);
      expect(isBalanced(p)).toBe(true);
      expect(p.filter((x) => x.debit > 0).reduce((a, x) => a + x.debit, 0)).toBe(amt);
    }
  });
  it('refund cap: cannot exceed the captured amount', () => {
    expect(() => refundPostings(total + 1, total, lines)).toThrow();
    expect(() => refundPostings(0, total, lines)).toThrow();
  });
});

describe('providers', () => {
  it('testpay parses its own events', () => {
    const e = new TestpayProvider().parse(JSON.stringify({ id: 'evt_tp_1', type: 'payment.failed', data: { intentId: 'tp_x', amountMinor: 500, reason: 'Your card was declined', last4: '0002' } }));
    expect(e).toMatchObject({ eventId: 'evt_tp_1', type: 'FAILED', providerIntentId: 'tp_x', amountMinor: 500, last4: '0002' });
  });

  it('testpay delivers a signed webhook that verifies', async () => {
    vi.useFakeTimers();
    process.env.TESTPAY_WEBHOOK_SECRET = SECRET;
    process.env.TESTPAY_DUPLICATE_RATE = '0';
    const calls: { headers: Record<string, string>; body: string }[] = [];
    const http = vi.fn(async (_url: string, init: any) => {
      calls.push({ headers: init.headers, body: init.body });
      return new Response('{}', { status: 200 });
    });
    new TestpayProvider(http as unknown as typeof fetch).deliver({ intentId: 'tp_1', amountMinor: 1000, succeeded: true, brand: 'visa', last4: '4242' });
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(calls).toHaveLength(1);
    expect(verify(SECRET, calls[0].body, calls[0].headers['testpay-signature'])).toEqual({ ok: true });
    expect(JSON.parse(calls[0].body)).toMatchObject({ type: 'payment.succeeded', data: { intentId: 'tp_1', amountMinor: 1000 } });
  });

  it('stripe adapter creates an intent with an idempotency key and maps webhook events', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    const http = vi.fn(async () => new Response(JSON.stringify({ id: 'pi_123', client_secret: 'pi_123_secret_abc' }), { status: 200 }));
    const s = new StripeProvider(http as unknown as typeof fetch);
    const r = await s.createSession({ orderId: 'o-1', orderNo: 'ORD-1', amountMinor: 129_900, currency: 'INR' });
    expect(r).toEqual({ providerIntentId: 'pi_123', clientSecret: 'pi_123_secret_abc', publishableKey: 'pk_test_x' });
    const [url, init] = http.mock.calls[0] as unknown as [string, any];
    expect(url).toBe('https://api.stripe.com/v1/payment_intents');
    expect(init.headers['idempotency-key']).toBe('pi:o-1');
    expect(init.body).toContain('amount=129900');
    expect(init.body).toContain('currency=inr');
    const ok = s.parse(JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_123', amount: 129_900, amount_received: 129_900 } } }));
    expect(ok).toMatchObject({ type: 'SUCCEEDED', providerIntentId: 'pi_123', amountMinor: 129_900 });
    const bad = s.parse(JSON.stringify({ id: 'evt_2', type: 'payment_intent.payment_failed', data: { object: { id: 'pi_123', amount: 129_900, last_payment_error: { message: 'declined' } } } }));
    expect(bad).toMatchObject({ type: 'FAILED', reason: 'declined' });
    expect(s.parse(JSON.stringify({ id: 'evt_3', type: 'charge.updated', data: { object: {} } })).type).toBe('IGNORED');
  });

  it('stripe surfaces API errors', async () => {
    const http = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 }));
    await expect(new StripeProvider(http as unknown as typeof fetch).createSession({ orderId: 'o', orderNo: 'n', amountMinor: 1, currency: 'INR' })).rejects.toThrow('Invalid API Key');
  });
});
