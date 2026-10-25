import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { type CloudEvent, type EventData, Events, type EventType, OrderDetailSchema, SellerOrderListSchema, TOPICS } from '@ac/contracts';
import { EventConsumerService, type PrincipalInfo } from '@ac/nest-common';
import { DataSource, type EntityManager } from 'typeorm';
import { CartService } from './cart.service.js';
import { CANCELLABLE, IllegalTransition, type OrderStatus as LoadedOrderStatus, refundRequiredFor, rollUp, sellerStatus } from './lifecycle.js';
import { type LoadedOrder, OrderRepo, rowsOf } from './order.repo.js';

const n = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const CURRENCY = 'INR';
type CancelReason = 'BUYER_CANCELLED' | 'PAYMENT_EXPIRED' | 'PAYMENT_FAILED' | 'RISK_REJECTED' | 'OUT_OF_STOCK';

/**
 * Order lifecycle after checkout: payment outcome (events), buyer cancel, seller ship, demo carrier delivery.
 * Every change goes through OrderRepo (transition table + version + order_events) and writes its event to the
 * outbox in the same transaction.
 */
@Injectable()
export class LifecycleService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(LifecycleService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: DataSource, private readonly repo: OrderRepo, private readonly events: EventConsumerService, private readonly cart: CartService) {}

  async onModuleInit() {
    await this.events.subscribe('order-payments', [TOPICS.payment], (e, tx) => this.onEvent(e, tx));
    await this.events.subscribe('order-inventory', [TOPICS.inventory], (e, tx) => this.onEvent(e, tx));
    const ms = Number(process.env.DELIVERY_SWEEP_MS ?? 30_000);
    if (ms > 0) this.timer = setInterval(() => void this.deliverDue().catch((e) => this.log.error(`delivery job failed: ${e.message}`)), ms);
  }
  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private parse<T extends EventType>(type: T, evt: CloudEvent): { data: EventData<T> } | null {
    const r = Events[type].safeParse(evt);
    if (!r.success) this.log.error(`skipping invalid ${type} ${evt.id}: ${r.error.issues[0]?.message}`);
    return r.success ? (r.data as { data: EventData<T> }) : null;
  }

  // ------------------------------------------------------------------ events
  async onEvent(evt: CloudEvent, tx: EntityManager) {
    if (evt.type === 'payment.succeeded.v1') {
      const e = this.parse('payment.succeeded.v1', evt);
      if (e) await this.paid(tx, e.data.orderId, e.data.paymentId);
    } else if (evt.type === 'payment.failed.v1') {
      const e = this.parse('payment.failed.v1', evt);
      if (e) await this.paymentEnded(tx, e.data.orderId, 'PAYMENT_FAILED', `payment failed: ${e.data.reason}`);
    } else if (evt.type === 'inventory.reservation_released.v1') {
      const e = this.parse('inventory.reservation_released.v1', evt);
      if (e && e.data.reason === 'EXPIRED') await this.paymentEnded(tx, e.data.orderId, 'PAYMENT_EXPIRED', 'payment window expired — stock released');
    }
  }

  private async paid(tx: EntityManager, orderId: string, paymentId: string) {
    const o = await this.repo.load(tx, orderId, true);
    if (!o) return this.log.warn(`payment for unknown order ${orderId}`);
    if (o.status !== 'PENDING_PAYMENT') {
      // late payment for an order that already expired/was cancelled → money must go back
      if ((o.status === 'CANCELLED' || o.status === 'PAYMENT_FAILED') && o.paymentStatus !== 'SUCCEEDED_LATE') {
        await tx.query(`UPDATE orders SET payment_status = 'SUCCEEDED_LATE' WHERE id = $1`, [o.id]);
        await this.emitCancelled(tx, o, 'PAYMENT_EXPIRED', 'payment arrived after the order was closed — refunding', true);
      }
      return;
    }
    await this.repo.transition(tx, o, 'PAID', 'system:payment', `payment ${paymentId}`, { payment_status: 'SUCCEEDED' });
    // REVIEW orders are confirmed too but stay flagged (risk_decision) for the fraud analyst — see service card
    await this.repo.transition(tx, o, 'CONFIRMED', 'system', o.riskDecision === 'REVIEW' ? 'confirmed — flagged for fraud review' : undefined);
    await this.repo.sellerAll(tx, o, 'CONFIRMED', 'system', { ship_by: new Date(Date.now() + 48 * 3_600_000) });
    await this.repo.emit(tx, 'order.confirmed.v1', o.id, { orderId: o.id, orderNo: o.orderNo, buyerId: o.buyerId, notifyEmail: o.notifyEmail, total: { amountMinor: o.totalMinor, currency: o.currency }, lines: this.repo.lineEvents(o) });
  }

  private async paymentEnded(tx: EntityManager, orderId: string, reason: 'PAYMENT_FAILED' | 'PAYMENT_EXPIRED', note: string) {
    const o = await this.repo.load(tx, orderId, true);
    if (!o || o.status !== 'PENDING_PAYMENT') return;
    await this.repo.transition(tx, o, reason === 'PAYMENT_FAILED' ? 'PAYMENT_FAILED' : 'CANCELLED', 'system:payment', note, { cancel_reason: reason, payment_status: reason === 'PAYMENT_FAILED' ? 'FAILED' : 'EXPIRED' });
    await this.repo.sellerAll(tx, o, 'CANCELLED', 'system:payment');
    await this.cart.restore(tx, o.buyerId, o.lines.filter((l) => l.offerId).map((l) => ({ offerId: l.offerId!, qty: l.qty, unitPriceMinor: l.unitPriceMinor })));
    await this.emitCancelled(tx, o, reason, note, false);
  }

  private emitCancelled(tx: EntityManager, o: LoadedOrder, reason: CancelReason, note: string, refundRequired: boolean) {
    return this.repo.emit(tx, 'order.cancelled.v1', o.id, { orderId: o.id, orderNo: o.orderNo, buyerId: o.buyerId, notifyEmail: o.notifyEmail, reason, note, refundRequired, amount: { amountMinor: o.totalMinor, currency: o.currency } });
  }

  // ------------------------------------------------------------------ commands
  async cancel(p: PrincipalInfo, idOrNo: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const id = await this.resolveId(tx, idOrNo);
      const o = await this.repo.load(tx, id, true);
      if (!o || o.buyerId !== p.sub) throw new NotFoundException('Order not found');
      if (!CANCELLABLE.includes(o.status) || o.sellerOrders.some((s) => ['SHIPPED', 'DELIVERED'].includes(sellerStatus(s.status))))
        throw new ConflictException({ code: 'NOT_CANCELLABLE', message: 'This order can no longer be cancelled — it has shipped. Return it after delivery instead.' });
      const refund = refundRequiredFor(o.status);
      await this.repo.transition(tx, o, 'CANCELLED', `user:${p.sub}`, reason, { cancel_reason: 'BUYER_CANCELLED' });
      await this.repo.sellerAll(tx, o, 'CANCELLED', `user:${p.sub}`);
      await this.emitCancelled(tx, o, 'BUYER_CANCELLED', reason, refund);
      return (await this.detailTx(tx, id)).dto;
    });
  }

  async ship(p: PrincipalInfo, sellerOrderId: string, carrier: string, trackingNo: string) {
    return this.db.transaction(async (tx) => {
      const [so] = rowsOf(await tx.query(`SELECT order_id, seller_id FROM seller_orders WHERE id = $1`, [sellerOrderId]));
      if (!so || so.seller_id !== p.sub) throw new NotFoundException('Seller order not found');
      const o = (await this.repo.load(tx, so.order_id, true))!;
      const s = o.sellerOrders.find((x) => x.id === sellerOrderId)!;
      s.status = sellerStatus(s.status);
      if (s.status !== 'CONFIRMED') throw new ConflictException({ code: 'NOT_SHIPPABLE', message: s.status === 'PENDING_PAYMENT' ? 'Wait for the payment before shipping.' : `This order is ${s.status.toLowerCase()}.` });
      await this.repo.sellerTransition(tx, o.id, s, 'SHIPPED', `user:${p.sub}`, { carrier, tracking_no: trackingNo, shipped_at: new Date() }, `${carrier} ${trackingNo}`);
      await this.rollUpOrder(tx, o, `user:${p.sub}`);
      await this.repo.emit(tx, 'order.shipped.v1', o.id, { orderId: o.id, orderNo: o.orderNo, sellerOrderId, sellerId: p.sub, buyerId: o.buyerId, notifyEmail: o.notifyEmail, carrier, trackingNo });
      return { sellerOrderId, status: 'SHIPPED', carrier, trackingNo, orderStatus: o.status };
    });
  }

  /** demo carrier: shipped seller orders are delivered DEMO_DELIVERY_MINUTES later */
  async deliverDue() {
    const minutes = Number(process.env.DEMO_DELIVERY_MINUTES ?? 3);
    let done = 0;
    await this.db.transaction(async (tx) => {
      const due = rowsOf(await tx.query(
        `SELECT id, order_id FROM seller_orders WHERE status = 'SHIPPED' AND shipped_at IS NOT NULL AND shipped_at < now() - make_interval(mins => $1) ORDER BY shipped_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
        [minutes],
      ));
      for (const d of due) {
        const o = (await this.repo.load(tx, d.order_id, true))!;
        const s = o.sellerOrders.find((x) => x.id === d.id)!;
        await this.repo.sellerTransition(tx, o.id, s, 'DELIVERED', 'system:carrier', { delivered_at: new Date() });
        await this.rollUpOrder(tx, o, 'system:carrier');
        await this.repo.emit(tx, 'order.delivered.v1', o.id, { orderId: o.id, orderNo: o.orderNo, sellerOrderId: s.id, sellerId: s.sellerId, buyerId: o.buyerId, notifyEmail: o.notifyEmail });
        done++;
      }
    });
    if (done) this.log.log(`demo carrier delivered ${done} seller order(s)`);
    return done;
  }

  private async rollUpOrder(tx: EntityManager, o: LoadedOrder, actor: string) {
    const next = rollUp(o.sellerOrders.map((s) => sellerStatus(s.status)));
    if (!next || next === o.status) return;
    try {
      await this.repo.transition(tx, o, next as LoadedOrderStatus, actor, undefined, next === 'SHIPPED' ? { shipped_at: new Date() } : next === 'DELIVERED' ? { delivered_at: new Date() } : {});
    } catch (e) {
      if (!(e instanceof IllegalTransition)) throw e;
      this.log.warn(`order ${o.orderNo}: ${e.message}`);
    }
  }

  // ------------------------------------------------------------------ reads
  async detail(p: PrincipalInfo, idOrNo: string) {
    const id = await this.resolveId(this.db.manager, idOrNo);
    const r = await this.detailTx(this.db.manager, id);
    const staff = p.roles.includes('admin') || p.roles.includes('support');
    if (!r || (r.buyerId !== p.sub && !staff)) throw new NotFoundException('Order not found');
    return r.dto;
  }

  private async resolveId(tx: EntityManager, idOrNo: string): Promise<string> {
    if (/^ORD-\d+$/.test(idOrNo)) {
      const [r] = rowsOf(await tx.query(`SELECT id FROM orders WHERE order_no = $1`, [idOrNo]));
      if (!r) throw new NotFoundException('Order not found');
      return r.id;
    }
    if (!/^[0-9a-f-]{36}$/i.test(idOrNo)) throw new NotFoundException('Order not found');
    return idOrNo;
  }

  private async detailTx(tx: EntityManager, id: string): Promise<any> {
    const [o] = rowsOf(await tx.query(`SELECT * FROM orders WHERE id = $1`, [id]));
    if (!o) return null;
    const subs = rowsOf(await tx.query(`SELECT * FROM seller_orders WHERE order_id = $1 ORDER BY placed_at, id`, [id]));
    const lines = rowsOf(await tx.query(`SELECT * FROM order_lines WHERE order_id = $1 ORDER BY id`, [id]));
    const events = rowsOf(await tx.query(`SELECT to_status, actor, at FROM order_events WHERE order_id = $1 AND seller_order_id IS NULL ORDER BY at, id`, [id]));
    const status = o.status as LoadedOrderStatus;
    const subStatus = subs.map((s: any) => sellerStatus(s.status));
    const timeline = events.length
      ? events.map((e: any) => ({ status: e.to_status, at: iso(e.at)!, actor: e.actor }))
      : [
          { status: 'PLACED', at: iso(o.placed_at)!, actor: 'buyer' },
          ...(o.shipped_at ? [{ status: 'SHIPPED', at: iso(o.shipped_at)!, actor: 'seller' }] : []),
          ...(o.delivered_at ? [{ status: 'DELIVERED', at: iso(o.delivered_at)!, actor: 'carrier' }] : []),
        ];
    const dto = OrderDetailSchema.parse({
      currency: o.currency ?? CURRENCY,
      orderId: o.id,
      orderNo: o.order_no,
      status,
      placedAt: iso(o.placed_at),
      subtotalMinor: n(o.subtotal_minor ?? o.total_minor),
      shippingMinor: n(o.shipping_minor),
      totalMinor: n(o.total_minor),
      shippingAddress: o.shipping_address ?? null,
      riskDecision: o.risk_decision ?? null,
      payment: o.payment_id ? { paymentId: o.payment_id, provider: o.payment_provider, status: o.payment_status ?? 'UNKNOWN' } : null,
      sellerOrders: subs.map((s: any) => {
        const mine = lines.filter((l: any) => (l.seller_order_id ? l.seller_order_id === s.id : l.seller_id === s.seller_id));
        return {
          sellerOrderId: s.id,
          sellerId: s.seller_id,
          sellerName: s.seller_name ?? mine[0]?.seller_name ?? 'Seller',
          status: sellerStatus(s.status),
          carrier: s.carrier ?? null,
          trackingNo: s.tracking_no ?? null,
          shippedAt: iso(s.shipped_at ?? (['SHIPPED', 'DELIVERED'].includes(sellerStatus(s.status)) ? o.shipped_at : null)),
          deliveredAt: iso(s.delivered_at ?? (sellerStatus(s.status) === 'DELIVERED' ? o.delivered_at : null)),
          lines: mine.map((l: any) => ({ offerId: l.offer_id ?? null, productId: l.product_id, title: l.title, qty: n(l.qty), unitPriceMinor: n(l.unit_price_minor) })),
        };
      }),
      timeline,
      canCancel: CANCELLABLE.includes(status) && !subStatus.some((s: string) => s === 'SHIPPED' || s === 'DELIVERED'),
    });
    return { buyerId: o.buyer_id, dto };
  }

  /** GET /sellers/me/orders?status= — default: open (to ship) */
  async sellerOrders(sellerId: string, status?: string) {
    const known = ['OPEN', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PENDING_PAYMENT', 'ALL'];
    if (status && !known.includes(status)) throw new BadRequestException(`status must be one of ${known.join(', ')}`);
    const filter =
      !status || status === 'OPEN' || status === 'CONFIRMED' ? `so.status IN ('CONFIRMED','PAID')`
      : status === 'SHIPPED' ? `so.status = 'SHIPPED'`
      : status === 'DELIVERED' ? `so.status IN ('DELIVERED','RETURN_IN_PROGRESS','REFUNDED')`
      : status === 'CANCELLED' ? `so.status IN ('CANCELLED','PAYMENT_FAILED','REJECTED')`
      : status === 'PENDING_PAYMENT' ? `so.status = 'PENDING_PAYMENT'`
      : 'TRUE';
    const rows = rowsOf(await this.db.query(
      `SELECT so.*, o.order_no, coalesce(o.shipping_address->>'city', o.ship_to_city) AS city
         FROM seller_orders so JOIN orders o ON o.id = so.order_id
        WHERE so.seller_id = $1 AND ${filter} ORDER BY so.placed_at DESC LIMIT 50`,
      [sellerId],
    ));
    const lines = rows.length
      ? rowsOf(await this.db.query(`SELECT * FROM order_lines WHERE order_id = ANY($1::uuid[]) AND seller_id = $2 ORDER BY id`, [rows.map((r: any) => r.order_id), sellerId]))
      : [];
    return SellerOrderListSchema.parse({
      currency: CURRENCY,
      items: rows.map((r: any) => ({
        sellerOrderId: r.id,
        orderNo: r.order_no,
        status: sellerStatus(r.status),
        placedAt: iso(r.placed_at),
        shipBy: iso(r.ship_by ?? new Date(new Date(r.placed_at).getTime() + 48 * 3_600_000)),
        buyerCity: r.city ?? null,
        totalMinor: n(r.total_minor) + n(r.shipping_minor),
        carrier: r.carrier ?? null,
        trackingNo: r.tracking_no ?? null,
        lines: lines.filter((l: any) => l.order_id === r.order_id && (!l.seller_order_id || l.seller_order_id === r.id)).map((l: any) => ({ productId: l.product_id, title: l.title, qty: n(l.qty), unitPriceMinor: n(l.unit_price_minor) })),
      })),
    });
  }
}
