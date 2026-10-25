import { describe, expect, it } from 'vitest';
import { add, allocate, money, percentBps, sum } from './index.js';

describe('money', () => {
  it('adds same-currency amounts and rejects mixed currencies', () => {
    expect(add(money(100, 'INR'), money(250, 'INR')).amountMinor).toBe(350);
    expect(() => add(money(1, 'INR'), money(1, 'USD'))).toThrow(/currency mismatch/);
  });
  it('rejects non-integer amounts', () => {
    expect(() => money(10.5, 'INR')).toThrow();
  });
  it('allocates without losing a paisa', () => {
    const parts = allocate(money(1000, 'INR'), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([334, 333, 333]);
    expect(sum(parts, 'INR').amountMinor).toBe(1000);
  });
  it('computes commission in basis points', () => {
    expect(percentBps(money(129900, 'INR'), 1200).amountMinor).toBe(15588);
  });
});
