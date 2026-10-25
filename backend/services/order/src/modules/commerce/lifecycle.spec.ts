import { describe, expect, it } from 'vitest';
import { assertTransition, dashboardStatus, IllegalTransition, rollUp, sellerStatus, shippingFor } from './lifecycle.js';

describe('order transitions', () => {
  it('allows the happy path', () => {
    for (const [a, b] of [['CREATED', 'PENDING_PAYMENT'], ['PENDING_PAYMENT', 'PAID'], ['PAID', 'CONFIRMED'], ['CONFIRMED', 'SHIPPED'], ['SHIPPED', 'DELIVERED']] as const) expect(() => assertTransition(a, b)).not.toThrow();
  });
  it('rejects skipping payment or reviving terminal states', () => {
    expect(() => assertTransition('CREATED', 'CONFIRMED')).toThrow(IllegalTransition);
    expect(() => assertTransition('CANCELLED', 'PAID')).toThrow(IllegalTransition);
    expect(() => assertTransition('SHIPPED', 'CANCELLED')).toThrow(IllegalTransition);
  });
  it('rolls seller orders up to the order', () => {
    expect(rollUp(['SHIPPED', 'CONFIRMED'])).toBe('PARTIALLY_SHIPPED');
    expect(rollUp(['SHIPPED', 'CANCELLED'])).toBe('SHIPPED');
    expect(rollUp(['DELIVERED', 'SHIPPED'])).toBe('SHIPPED');
    expect(rollUp(['DELIVERED', 'DELIVERED'])).toBe('DELIVERED');
    expect(rollUp(['CONFIRMED'])).toBeNull();
  });
});

describe('shipping', () => {
  it('charges ₹40 per seller below ₹499, free at or above', () => {
    const r = shippingFor([
      { sellerId: 'a', unitPriceMinor: 20_000, qty: 2 }, // 400 → ₹40
      { sellerId: 'b', unitPriceMinor: 49_900, qty: 1 }, // free
      { sellerId: 'a', unitPriceMinor: 5_000, qty: 1 }, // a = 450 → still ₹40
    ]);
    expect(r.total).toBe(4_000);
    expect(r.perSeller.get('b')).toBe(0);
    expect(r.subtotal).toBe(94_900);
  });
});

describe('dashboard mapping', () => {
  it('maps new statuses into the narrower dashboard enum', () => {
    expect(dashboardStatus('PARTIALLY_SHIPPED')).toBe('SHIPPED');
    expect(dashboardStatus('PAYMENT_FAILED')).toBe('CANCELLED');
    expect(sellerStatus('PAID')).toBe('CONFIRMED');
  });
});
