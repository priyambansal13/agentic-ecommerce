import { describe, expect, it } from 'vitest';
import { closingFee, LAUNCH_SCHEDULE, lineFees, validateTerms } from './fee-math.js';

describe('lineFees (launch schedule)', () => {
  it('electronics ₹1,999 × 1', () => {
    const f = lineFees(LAUNCH_SCHEDULE, 'electronics', 199_900, 1);
    // referral 8 % = 15 992 · closing (> ₹1,000) 4 000 · payment 2 % = 3 998 · GST 18 % of 23 990 = 4 318
    expect(f).toEqual({ saleMinor: 199_900, referralMinor: 15_992, closingMinor: 4_000, paymentMinor: 3_998, gstMinor: 4_318, totalFeesMinor: 28_308, sellerEarnsMinor: 171_592 });
  });
  it('fashion ₹499 × 2 uses the ≤ ₹500 band per unit', () => {
    const f = lineFees(LAUNCH_SCHEDULE, 'fashion', 49_900, 2);
    expect(f.referralMinor).toBe(16_966); // 17 % of 99 800
    expect(f.closingMinor).toBe(2_000);
    expect(f.saleMinor - f.totalFeesMinor).toBe(f.sellerEarnsMinor);
  });
  it('applies the minimum referral fee', () => {
    expect(lineFees(LAUNCH_SCHEDULE, 'jewellery', 10_000, 3).referralMinor).toBe(6_000); // 15 % = 4 500 < 3 × 2 000
  });
  it('falls back to the * rule for unknown categories', () => {
    expect(lineFees(LAUNCH_SCHEDULE, 'toys', 100_000, 1).referralMinor).toBe(12_000);
  });
  it('rounds half up', () => {
    expect(lineFees({ ...LAUNCH_SCHEDULE, paymentFeeBps: 250 }, 'grocery', 10_002, 1).paymentMinor).toBe(250); // 250.05 → 250
    expect(lineFees({ ...LAUNCH_SCHEDULE, paymentFeeBps: 250 }, 'grocery', 10_020, 1).paymentMinor).toBe(251); // 250.5 → 251
  });
});

describe('closingFee', () => {
  it('picks the first band that covers the price', () => {
    const b = LAUNCH_SCHEDULE.rules[0].closingFees;
    expect([closingFee(b, 30_000), closingFee(b, 30_001), closingFee(b, 100_000), closingFee(b, 5_000_000)]).toEqual([500, 1_000, 2_000, 4_000]);
  });
});

describe('validateTerms', () => {
  it('accepts the launch schedule', () => expect(validateTerms(LAUNCH_SCHEDULE)).toEqual([]));
  it('requires a default rule, open-ended last band and ascending bands', () => {
    const p = validateTerms({ rules: [{ category: 'home', referralBps: 1, minReferralMinor: 0, closingFees: [{ upToMinor: 500, feeMinor: 1 }, { upToMinor: 100, feeMinor: 1 }] }] });
    expect(p).toHaveLength(3);
  });
});
