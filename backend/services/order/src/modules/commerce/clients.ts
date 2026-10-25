import { Injectable } from '@nestjs/common';
import { OfferLookupSchema, PaymentSessionSchema, ReservationSchema, RiskResultSchema, StockLevelsSchema } from '@ac/contracts';
import { DependencyError, ServiceClient } from '@ac/nest-common';
import type { z } from 'zod';
import { OutOfStock, Unavailable } from './saga.js';

export type Offer = z.infer<typeof OfferLookupSchema>['items'][number];

/** Typed calls from the order service to catalog, inventory, fraud and payment (all through Kong). */
@Injectable()
export class CommerceClients {
  constructor(private readonly svc: ServiceClient) {}

  async offers(ids: string[]): Promise<Map<string, Offer>> {
    const out = new Map<string, Offer>();
    for (let i = 0; i < ids.length; i += 50) {
      const r = await this.svc.call('catalog', 'GET', `/offers?ids=${ids.slice(i, i + 50).join(',')}`, { schema: OfferLookupSchema, timeoutMs: 1500 });
      for (const o of r.items) out.set(o.offerId, o);
    }
    return out;
  }

  async stock(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const r = await this.svc.call('inventory', 'GET', `/stock?skuIds=${ids.join(',')}`, { schema: StockLevelsSchema, timeoutMs: 1500 });
    return new Map(r.items.map((i) => [i.skuId, i.available]));
  }

  score(body: unknown) {
    // 300 ms budget, no retries (not idempotent from the caller's view → the scorer is idempotent per order anyway)
    return this.svc.call('fraud', 'POST', '/internal/risk/score', { body, schema: RiskResultSchema, timeoutMs: Number(process.env.FRAUD_TIMEOUT_MS ?? 300) });
  }

  async reserve(orderId: string, lines: { skuId: string; qty: number }[], ttlSec: number) {
    try {
      return await this.svc.call('inventory', 'POST', '/internal/reservations', { body: { orderId, lines, ttlSec }, idempotencyKey: `reserve:${orderId}`, schema: ReservationSchema, timeoutMs: 2000 });
    } catch (e) {
      if (e instanceof DependencyError && e.status === 409) throw new OutOfStock(((e.body as { skuIds?: string[] })?.skuIds ?? []) as string[]);
      throw new Unavailable((e as Error).message);
    }
  }

  async release(orderId: string) {
    await this.svc.call('inventory', 'POST', `/internal/reservations/${orderId}/release`, { idempotencyKey: `release:${orderId}`, timeoutMs: 2000 }).catch((e) => {
      if (e instanceof DependencyError && e.status === 404) return; // never reserved
      throw e;
    });
  }

  async createPayment(body: unknown, orderId: string) {
    try {
      return await this.svc.call('payment', 'POST', '/internal/payments', { body, idempotencyKey: `payment:${orderId}`, schema: PaymentSessionSchema, timeoutMs: 3000 });
    } catch (e) {
      throw new Unavailable((e as Error).message);
    }
  }
}
