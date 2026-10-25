/**
 * testpay card rules (TEST provider, no real money). Mirrors common gateway test cards:
 *   4242 4242 4242 4242 → succeeds · 4000 0000 0000 0002 → declined · 4000 0000 0000 9995 → insufficient funds.
 * Any other Luhn-valid number succeeds; a Luhn-invalid number or a past expiry is rejected before submission.
 * Only the brand and last 4 digits ever leave this function.
 */
export type CardOutcome = 'SUCCEEDED' | 'DECLINED' | 'INSUFFICIENT_FUNDS';
export interface CardCheck {
  ok: boolean;
  error?: 'INVALID_NUMBER' | 'EXPIRED';
  outcome?: CardOutcome;
  brand: string;
  last4: string;
}

export function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export function brandOf(digits: string) {
  if (digits.startsWith('4')) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  if (/^(60|65|81|82|508)/.test(digits)) return 'rupay';
  if (/^3[47]/.test(digits)) return 'amex';
  return 'card';
}

export function checkCard(cardNumber: string, expiry: string, now = new Date()): CardCheck {
  const digits = cardNumber.replace(/\s+/g, '');
  const base = { brand: brandOf(digits), last4: digits.slice(-4) };
  if (!/^\d{13,19}$/.test(digits) || !luhn(digits)) return { ok: false, error: 'INVALID_NUMBER', ...base };
  const [mm, yy] = expiry.split('/').map(Number);
  const endOfMonth = new Date(Date.UTC(2000 + yy, mm, 1)); // first day of the following month
  if (endOfMonth <= now) return { ok: false, error: 'EXPIRED', ...base };
  const outcome: CardOutcome = digits === '4000000000000002' ? 'DECLINED' : digits === '4000000000009995' ? 'INSUFFICIENT_FUNDS' : 'SUCCEEDED';
  return { ok: true, outcome, ...base };
}
