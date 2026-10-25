import { ConflictException, Injectable } from '@nestjs/common';
import { TOPICS } from '@ac/contracts';
import { OutboxService } from '@ac/nest-common';
import type { EntityManager } from 'typeorm';
import { assertSellerTransition, assertTransition, IllegalTransition, type OrderStatus, type SellerOrderStatus, sellerStatus } from './lifecycle.js';

const n = (v: unknown) => Number(v ?? 0);
export const rowsOf = (r: any): any[] => (Array.isArray(r) && Array.isArray(r[0]) && typeof r[1] === 'number' ? r[0] : r);

export interface LoadedOrder {
  id: string;
  orderNo: string;
  buyerId: string;
  status: OrderStatus;
  version: number;
  totalMinor: number;
  currency: string;
  notifyEmail: string | null;
  riskDecision: string | null;
  paymentStatus: string | null;
  lines: { offerId: string | null; productId: string; title: string; category: string; sellerId: string; sellerName: string; sellerOrderId: string | null; qty: number; unitPriceMinor: number }[];
  sellerOrders: { id: string; sellerId: string; status: SellerOrderStatus; version: number }[];
}

/** Guarded state changes: transition table + row lock + version bump + order_events row (+ outbox by callers, same tx). */
@Injectable()
export class OrderRepo {
  constructor(private readonly outbox: OutboxService) {}

  async load(tx: EntityManager, orderId: string, lock = false): Promise<LoadedOrder | null> {
    const [o] = rowsOf(await tx.query(`SELECT * FROM orders WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [orderId]));
    if (!o) return null;
    const lines = rowsOf(await tx.query(`SELECT * FROM order_lines WHERE order_id = $1 ORDER BY id`, [orderId]));
    const subs = rowsOf(await tx.query(`SELECT id, seller_id, status, version FROM seller_orders WHERE order_id = $1 ORDER BY id ${lock ? 'FOR UPDATE' : ''}`, [orderId]));
    return {
      id: o.id,
      orderNo: o.order_no,
      buyerId: o.buyer_id,
      status: o.status,
      version: n(o.version),
      totalMinor: n(o.total_minor),
      currency: o.currency,
      notifyEmail: o.notify_email,
      riskDecision: o.risk_decision,
      paymentStatus: o.payment_status,
      lines: lines.map((l: any) => ({ offerId: l.offer_id, productId: l.product_id, title: l.title, category: l.category, sellerId: l.seller_id, sellerName: l.seller_name, sellerOrderId: l.seller_order_id, qty: n(l.qty), unitPriceMinor: n(l.unit_price_minor) })),
      sellerOrders: subs.map((s: any) => ({ id: s.id, sellerId: s.seller_id, status: sellerStatus(s.status), version: n(s.version) })),
    };
  }

  /** order-level transition; throws IllegalTransition (→ 409) when the table forbids it */
  async transition(tx: EntityManager, o: LoadedOrder, to: OrderStatus, actor: string, note?: string, extra: Record<string, unknown> = {}) {
    assertTransition(o.status, to);
    const sets = Object.keys(extra).map((k, i) => `${k} = $${i + 4}`);
    const r = rowsOf(await tx.query(
      `UPDATE orders SET status = $2, version = version + 1, updated_at = now()${sets.length ? `, ${sets.join(', ')}` : ''} WHERE id = $1 AND version = $3 RETURNING id`,
      [o.id, to, o.version, ...Object.values(extra)],
    ));
    if (!r.length) throw new ConflictException('The order changed meanwhile — reload and try again');
    await tx.query(`INSERT INTO order_events (order_id, from_status, to_status, actor, note) VALUES ($1, $2, $3, $4, $5)`, [o.id, o.status, to, actor, note ?? null]);
    o.status = to;
    o.version += 1;
  }

  async sellerTransition(tx: EntityManager, orderId: string, s: { id: string; status: SellerOrderStatus; version: number }, to: SellerOrderStatus, actor: string, extra: Record<string, unknown> = {}, note?: string) {
    assertSellerTransition(s.status, to);
    const sets = Object.keys(extra).map((k, i) => `${k} = $${i + 4}`);
    const r = rowsOf(await tx.query(
      `UPDATE seller_orders SET status = $2, version = version + 1${sets.length ? `, ${sets.join(', ')}` : ''} WHERE id = $1 AND version = $3 RETURNING id`,
      [s.id, to, s.version, ...Object.values(extra)],
    ));
    if (!r.length) throw new ConflictException('The seller order changed meanwhile — reload and try again');
    await tx.query(`INSERT INTO order_events (order_id, seller_order_id, from_status, to_status, actor, note) VALUES ($1, $2, $3, $4, $5, $6)`, [orderId, s.id, s.status, to, actor, note ?? null]);
    s.status = to;
    s.version += 1;
  }

  /** move every live (non-terminal) seller order to `to` where the table allows it */
  async sellerAll(tx: EntityManager, o: LoadedOrder, to: SellerOrderStatus, actor: string, extra: Record<string, unknown> = {}) {
    for (const s of o.sellerOrders) {
      try {
        await this.sellerTransition(tx, o.id, s, to, actor, extra);
      } catch (e) {
        if (!(e instanceof IllegalTransition)) throw e;
      }
    }
  }

  lineEvents(o: LoadedOrder) {
    return o.lines.map((l) => ({
      skuId: l.offerId ?? l.productId,
      sellerId: l.sellerId,
      qty: l.qty,
      unitPriceMinor: l.unitPriceMinor,
      productId: l.productId,
      category: l.category,
      title: l.title,
      ...(l.sellerOrderId ? { sellerOrderId: l.sellerOrderId } : {}),
    }));
  }

  emit(tx: EntityManager, type: string, orderId: string, data: unknown) {
    return this.outbox.enqueue(tx, { topic: TOPICS.order, type, aggregateId: orderId, data });
  }
}
