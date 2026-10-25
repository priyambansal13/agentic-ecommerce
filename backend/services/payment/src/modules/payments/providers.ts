import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sign } from './signature.js';

/** What a gateway webhook means once verified and normalised. */
export interface NormalizedEvent {
  eventId: string;
  type: 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'IGNORED';
  rawType: string;
  providerIntentId: string | null;
  amountMinor: number | null;
  brand?: string | null;
  last4?: string | null;
  reason?: string | null;
}

export interface SessionResult { providerIntentId: string; clientSecret: string | null; publishableKey: string | null }

export interface ProviderAdapter {
  readonly name: 'testpay' | 'stripe';
  enabled(): boolean;
  /** signature header the gateway sends */
  readonly signatureHeader: string;
  webhookSecret(): string;
  createSession(p: { orderId: string; orderNo: string; amountMinor: number; currency: string }): Promise<SessionResult>;
  refund(p: { providerIntentId: string; amountMinor: number; refundId: string }): Promise<{ providerRefundId: string }>;
  cancel(providerIntentId: string): Promise<void>;
  parse(rawBody: string): NormalizedEvent;
}

type Fetch = typeof fetch;

// ───────────────────────────────────────────── testpay: built-in TEST gateway (no real money)
/**
 * Simulates a card gateway end to end so the real webhook path (signature over the raw body, dedupe, async
 * truth) is exercised locally and in demos. The "gateway" delivers its webhook ~1 s after a card is submitted,
 * sometimes twice (TESTPAY_DUPLICATE_RATE, default 0.25) to prove idempotency, and retries non-2xx up to 3 times.
 */
@Injectable()
export class TestpayProvider implements ProviderAdapter {
  readonly name = 'testpay' as const;
  readonly signatureHeader = 'testpay-signature';
  private readonly log = new Logger('testpay');
  constructor(private readonly http: Fetch = fetch) {}

  enabled() {
    return Boolean(process.env.TESTPAY_WEBHOOK_SECRET);
  }
  webhookSecret() {
    return process.env.TESTPAY_WEBHOOK_SECRET ?? '';
  }
  async createSession() {
    return { providerIntentId: `tp_${randomUUID().replaceAll('-', '')}`, clientSecret: null, publishableKey: null };
  }
  async refund() {
    return { providerRefundId: `tpre_${randomUUID().replaceAll('-', '')}` };
  }
  async cancel() {}

  parse(rawBody: string): NormalizedEvent {
    const e = JSON.parse(rawBody) as { id: string; type: string; data: { intentId: string; amountMinor: number; brand?: string; last4?: string; reason?: string } };
    const type = e.type === 'payment.succeeded' ? 'SUCCEEDED' : e.type === 'payment.failed' ? 'FAILED' : 'IGNORED';
    return { eventId: e.id, type, rawType: e.type, providerIntentId: e.data?.intentId ?? null, amountMinor: e.data?.amountMinor ?? null, brand: e.data?.brand, last4: e.data?.last4, reason: e.data?.reason };
  }

  /** The gateway side: build, sign and deliver a webhook for a submitted card (fire and forget). */
  deliver(outcome: { intentId: string; amountMinor: number; succeeded: boolean; brand: string; last4: string; reason?: string }) {
    const body = JSON.stringify({
      id: `evt_tp_${randomUUID().replaceAll('-', '')}`,
      type: outcome.succeeded ? 'payment.succeeded' : 'payment.failed',
      created: Math.floor(Date.now() / 1000),
      data: { intentId: outcome.intentId, amountMinor: outcome.amountMinor, brand: outcome.brand, last4: outcome.last4, reason: outcome.reason ?? null },
    });
    const url = process.env.TESTPAY_WEBHOOK_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4106}/v1/webhooks/testpay`;
    const dupRate = Number(process.env.TESTPAY_DUPLICATE_RATE ?? 0.25);
    const send = async (attempt = 1): Promise<void> => {
      try {
        const r = await this.http(url, { method: 'POST', headers: { 'content-type': 'application/json', [this.signatureHeader]: sign(this.webhookSecret(), body) }, body, signal: AbortSignal.timeout(5_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (err) {
        if (attempt >= 3) return void this.log.error(`webhook delivery failed after ${attempt} attempts: ${(err as Error).message}`);
        await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
        return send(attempt + 1);
      }
    };
    setTimeout(() => {
      void send().then(() => (Math.random() < dupRate ? send() : undefined));
    }, Number(process.env.TESTPAY_DELAY_MS ?? 1_000));
  }
}

// ───────────────────────────────────────────── Stripe (test mode), enabled only when keys are configured
const STRIPE_API = 'https://api.stripe.com/v1';

@Injectable()
export class StripeProvider implements ProviderAdapter {
  readonly name = 'stripe' as const;
  readonly signatureHeader = 'stripe-signature';
  constructor(private readonly http: Fetch = fetch) {}

  enabled() {
    return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PUBLISHABLE_KEY);
  }
  webhookSecret() {
    return process.env.STRIPE_WEBHOOK_SECRET ?? '';
  }

  private async call<T>(path: string, form: Record<string, string>, idempotencyKey?: string): Promise<T> {
    const r = await this.http(`${STRIPE_API}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await r.json()) as T & { error?: { message: string } };
    if (!r.ok) throw new Error(`stripe ${path}: ${body.error?.message ?? r.status}`);
    return body;
  }

  async createSession(p: { orderId: string; orderNo: string; amountMinor: number; currency: string }) {
    const pi = await this.call<{ id: string; client_secret: string }>(
      '/payment_intents',
      { amount: String(p.amountMinor), currency: p.currency.toLowerCase(), 'automatic_payment_methods[enabled]': 'true', 'metadata[orderId]': p.orderId, 'metadata[orderNo]': p.orderNo, description: `agentic.commerce ${p.orderNo}` },
      `pi:${p.orderId}`,
    );
    return { providerIntentId: pi.id, clientSecret: pi.client_secret, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null };
  }

  async refund(p: { providerIntentId: string; amountMinor: number; refundId: string }) {
    const re = await this.call<{ id: string }>('/refunds', { payment_intent: p.providerIntentId, amount: String(p.amountMinor) }, `re:${p.refundId}`);
    return { providerRefundId: re.id };
  }

  async cancel(providerIntentId: string) {
    await this.call(`/payment_intents/${providerIntentId}/cancel`, {}).catch(() => undefined);
  }

  parse(rawBody: string): NormalizedEvent {
    const e = JSON.parse(rawBody) as { id: string; type: string; data: { object: any } };
    const o = e.data?.object ?? {};
    const card = o.charges?.data?.[0]?.payment_method_details?.card ?? o.last_payment_error?.payment_method?.card;
    const base = { eventId: e.id, rawType: e.type, brand: card?.brand ?? null, last4: card?.last4 ?? null };
    if (e.type === 'payment_intent.succeeded') return { ...base, type: 'SUCCEEDED', providerIntentId: o.id, amountMinor: o.amount_received ?? o.amount };
    if (e.type === 'payment_intent.payment_failed') return { ...base, type: 'FAILED', providerIntentId: o.id, amountMinor: o.amount, reason: o.last_payment_error?.message ?? 'payment failed' };
    return { ...base, type: 'IGNORED', providerIntentId: o.payment_intent ?? o.id ?? null, amountMinor: null };
  }
}
