import { describe, expect, it } from 'vitest';
import { evaluate } from './rules.js';

const base = { totalMinor: 2_000_00, itemCount: 2, sellerCount: 1, pincode: '411001', accountAgeDays: null, ordersLastHour: 0, priorOrders: 5 };
describe('fraud rules v1', () => {
  it('allows an ordinary order', () => expect(evaluate(base)).toEqual({ score: 0, decision: 'ALLOW', rules: [] }));
  it('reviews high value', () => expect(evaluate({ ...base, totalMinor: 60_000_00 }).decision).toBe('REVIEW'));
  it('blocks blocked pincode + velocity', () => {
    const r = evaluate({ ...base, pincode: '999999', ordersLastHour: 3 });
    expect(r.decision).toBe('BLOCK');
    expect(r.rules).toEqual(['velocity_orders_1h', 'blocked_pincode']);
  });
  it('first big order of an unknown-age account is only a signal', () => expect(evaluate({ ...base, priorOrders: 0, totalMinor: 12_000_00 })).toMatchObject({ decision: 'ALLOW', rules: ['first_order_high_value'] }));
});
