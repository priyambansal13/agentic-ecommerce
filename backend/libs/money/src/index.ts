/**
 * Money is always an integer amount of minor units (paise, cents) plus an ISO-4217 currency.
 * Never use floats for money. DB columns: bigint `*_minor` + text `currency`.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

const MINOR_DIGITS: Record<string, number> = { INR: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0 };

export const minorDigits = (currency: string) => MINOR_DIGITS[currency] ?? 2;

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError(`amountMinor must be a safe integer, got ${amountMinor}`);
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError(`invalid currency ${currency}`);
  return Object.freeze({ amountMinor, currency });
}

function same(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new TypeError(`currency mismatch: ${a.currency} vs ${b.currency}`);
}

export const add = (a: Money, b: Money) => (same(a, b), money(a.amountMinor + b.amountMinor, a.currency));
export const subtract = (a: Money, b: Money) => (same(a, b), money(a.amountMinor - b.amountMinor, a.currency));
export const sum = (items: Money[], currency: string) => items.reduce((acc, m) => add(acc, m), money(0, currency));
export const multiply = (a: Money, qty: number) => {
  if (!Number.isInteger(qty)) throw new RangeError('quantity must be an integer');
  return money(a.amountMinor * qty, a.currency);
};
export const isNegative = (a: Money) => a.amountMinor < 0;
export const compare = (a: Money, b: Money) => (same(a, b), Math.sign(a.amountMinor - b.amountMinor));

/** Split an amount into parts proportional to integer weights; remainders go to the first parts (sum is exact). */
export function allocate(a: Money, weights: number[]): Money[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) throw new RangeError('weights must sum to > 0');
  const parts = weights.map((w) => Math.floor((a.amountMinor * w) / total));
  let rest = a.amountMinor - parts.reduce((s, p) => s + p, 0);
  for (let i = 0; rest > 0; i = (i + 1) % parts.length, rest--) parts[i] += 1;
  return parts.map((p) => money(p, a.currency));
}

/** Basis points (1% = 100 bps), rounded half-up — e.g. platform commission. */
export const percentBps = (a: Money, bps: number) => money(Math.round((a.amountMinor * bps) / 10_000), a.currency);

export const format = (a: Money, locale = 'en-IN') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: a.currency }).format(a.amountMinor / 10 ** minorDigits(a.currency));
