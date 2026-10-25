import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type CloudEvent, type EventData, Events, type EventType, TOPICS } from '@ac/contracts';
import { EventConsumerService } from '@ac/nest-common';
import type { EntityManager } from 'typeorm';
import { StockService } from './stock.service.js';

/**
 * Idempotent consumers (processed_events dedupe in the same tx):
 *  catalog.offer_created.v1 → new SKU · payment.succeeded.v1 → commit · payment.failed.v1 → release ·
 *  order.cancelled.v1 → release (still ACTIVE) or return committed units.
 */
@Injectable()
export class StockEvents implements OnModuleInit {
  private readonly log = new Logger(StockEvents.name);
  constructor(private readonly events: EventConsumerService, private readonly stock: StockService) {}

  async onModuleInit() {
    await this.events.subscribe('inventory-catalog', [TOPICS.catalog], (e, tx) => this.onEvent(e, tx));
    await this.events.subscribe('inventory-payments', [TOPICS.payment], (e, tx) => this.onEvent(e, tx));
    await this.events.subscribe('inventory-orders', [TOPICS.order], (e, tx) => this.onEvent(e, tx));
  }

  private parse<T extends EventType>(type: T, evt: CloudEvent): { data: EventData<T> } | null {
    const r = Events[type].safeParse(evt);
    if (!r.success) this.log.error(`skipping invalid ${type} ${evt.id}: ${r.error.issues[0]?.message}`);
    return r.success ? (r.data as { data: EventData<T> }) : null;
  }

  async onEvent(evt: CloudEvent, tx: EntityManager) {
    switch (evt.type) {
      case 'catalog.offer_created.v1': {
        const e = this.parse('catalog.offer_created.v1', evt);
        if (e) await this.stock.createSku(tx, e.data);
        return;
      }
      case 'payment.succeeded.v1': {
        const e = this.parse('payment.succeeded.v1', evt);
        if (e) {
          const r = await this.stock.commit(e.data.orderId, tx);
          if (r && r.status !== 'COMMITTED') this.log.warn(`payment for ${e.data.orderId} succeeded but reservation is ${r.status} — order service refunds`);
        }
        return;
      }
      case 'payment.failed.v1': {
        const e = this.parse('payment.failed.v1', evt);
        if (e) await this.stock.release(e.data.orderId, 'PAYMENT_FAILED', tx);
        return;
      }
      case 'order.cancelled.v1': {
        const e = this.parse('order.cancelled.v1', evt);
        if (!e) return;
        const r = await this.stock.release(e.data.orderId, 'ORDER_CANCELLED', tx);
        if (r?.status === 'COMMITTED') await this.stock.returnCommitted(e.data.orderId, tx);
        return;
      }
    }
  }
}
