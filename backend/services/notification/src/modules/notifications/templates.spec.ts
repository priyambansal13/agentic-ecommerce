import { describe, expect, it } from 'vitest';
import { esc, render, rupees } from './templates.js';

const base = { orderNo: 'ORD-260001', appUrl: 'http://localhost:3300' };

describe('templates', () => {
  it('formats rupees in en-IN', () => {
    expect(rupees(12_345_600)).toBe('₹1,23,456');
    expect(rupees(129_950)).toBe('₹1,299.50');
  });
  it('confirmation lists items and the total', () => {
    const r = render('ORDER_CONFIRMED', { ...base, lines: [{ title: 'Linen shirt', qty: 2, unitPriceMinor: 129_900 }], totalMinor: 263_800 });
    expect(r.subject).toContain('ORD-260001');
    expect(r.text).toContain('Linen shirt × 2');
    expect(r.html).toContain('₹2,638');
  });
  it('escapes untrusted titles and notes (no HTML injection)', () => {
    const r = render('ORDER_CONFIRMED', { ...base, lines: [{ title: '<img src=x onerror=alert(1)>', qty: 1, unitPriceMinor: 100 }], totalMinor: 100 });
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).toContain('&lt;img');
    expect(render('ORDER_CANCELLED', { ...base, reason: 'BUYER_CANCELLED', note: '"><script>', refundRequired: false }).html).not.toContain('<script>');
    expect(esc(`<a href="x">'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;');
  });
  it('shipped links to the carrier tracking page', () => {
    expect(render('ORDER_SHIPPED', { ...base, carrier: 'Delhivery', trackingNo: 'DL12345678' }).html).toContain('https://www.delhivery.com/track/package/DL12345678');
  });
  it('cancellation explains the refund', () => {
    expect(render('ORDER_CANCELLED', { ...base, reason: 'BUYER_CANCELLED', refundRequired: true, amountMinor: 50_000 }).text).toContain('refund of ₹500');
    expect(render('ORDER_CANCELLED', { ...base, reason: 'PAYMENT_EXPIRED', refundRequired: false }).text).toContain('not been charged');
  });
});
