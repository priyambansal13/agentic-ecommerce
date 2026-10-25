import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signatures, Stripe scheme: header `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 * Used for Stripe (`Stripe-Signature`) and the testpay gateway (`Testpay-Signature`). The timestamp tolerance
 * rejects replays of captured requests; duplicates within the window are deduped by event id (webhook_events).
 */
export const SIGNATURE_TOLERANCE_SEC = 300;

export function sign(secret: string, rawBody: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'MISSING' | 'MALFORMED' | 'BAD_SIGNATURE' | 'TIMESTAMP_OUT_OF_RANGE' };

export function verify(secret: string, rawBody: string, header: string | undefined, now = Math.floor(Date.now() / 1000), toleranceSec = SIGNATURE_TOLERANCE_SEC): VerifyResult {
  if (!header) return { ok: false, reason: 'MISSING' };
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(parts.t);
  const sigs = header.split(',').map((p) => p.trim()).filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!Number.isInteger(t) || !sigs.length) return { ok: false, reason: 'MALFORMED' };
  if (Math.abs(now - t) > toleranceSec) return { ok: false, reason: 'TIMESTAMP_OUT_OF_RANGE' };
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'hex');
  const match = sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return match ? { ok: true } : { ok: false, reason: 'BAD_SIGNATURE' };
}
