import { ConflictException, HttpException, Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { type CheckoutInput, CheckoutResultSchema, type PaymentSession } from '@ac/contracts';
import type { PrincipalInfo } from '@ac/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CartService } from './cart.service.js';
import { CommerceClients, type Offer } from './clients.js';
import { shippingFor } from './lifecycle.js';
import { OrderRepo } from './order.repo.js';
import { runCheckoutSaga, SagaRejected } from './saga.js';

const CURRENCY = 'INR';
const SHIP_BY_HOURS = 48;

/**
 * POST /v1/checkout — orchestrated saga (LLD §2.5). The order row and its history are written first so every
 * outcome (rejected, pending payment) is visible and auditable; compensations release stock if a later step fails.
 */
@Injectable()
export class CheckoutService {
  private readonly log = new Logger(CheckoutService.name);
  constructor(private readonly db: DataSource, private readonly cart: CartService, private readonly clients: CommerceClients, private readonly repo: OrderRepo) {}

  async checkout(p: PrincipalInfo, input: CheckoutInput) {
    const buyer = { kind: 'buyer' as const, id: p.sub };
    const items = await this.cart.items(buyer);
    if (!items.length) throw new UnprocessableEntityException({ code: 'CART_EMPTY', message: 'Your cart is empty.', offerIds: [] });

    // 1. re-price from catalog (must succeed — never sell at a stale price)
    let offers: Map<string, Offer>;
    try {
      offers = await this.clients.offers(items.map((i) => i.offerId));
    } catch {
      throw new ServiceUnavailableException({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Checkout is temporarily unavailable — nothing was charged.', offerIds: [] });
    }
    const gone = items.filter((i) => !offers.get(i.offerId)?.active).map((i) => i.offerId);
    if (gone.length) throw new ConflictException({ code: 'OFFER_UNAVAILABLE', message: 'Some items are no longer available — review your cart.', offerIds: gone });
    const lines = items.map((i) => {
      const o = offers.get(i.offerId)!;
      return { offerId: i.offerId, productId: o.productId, title: o.title, category: o.category, sellerId: o.sellerId, sellerName: o.sellerName, qty: i.qty, unitPriceMinor: o.priceMinor };
    });
    const ship = shippingFor(lines);
    const total = ship.subtotal + ship.total;
    if (total !== input.expectedTotalMinor)
      throw new ConflictException({ code: 'TOTAL_CHANGED', message: `Prices changed since you opened checkout — the new total is ₹${(total / 100).toLocaleString('en-IN')}.`, offerIds: lines.filter((l) => l.unitPriceMinor !== items.find((i) => i.offerId === l.offerId)!.addedPriceMinor).map((l) => l.offerId) });

    // 2. ORDER(CREATED) + seller sub-orders + lines + history + order.created.v1 — one transaction
    const orderId = randomUUID();
    const a = input.shippingAddress;
    const orderNo = await this.db.transaction(async (tx) => {
      const [{ no }] = await tx.query(`SELECT 'ORD-' || nextval('order_no_seq') AS no`);
      await tx.query(
        `INSERT INTO orders (id, order_no, buyer_id, status, total_minor, subtotal_minor, shipping_minor, currency, items, placed_at, ship_to_name, ship_to_city, shipping_address, notify_email)
         VALUES ($1, $2, $3, 'CREATED', $4, $5, $6, $7, $8, now(), $9, $10, $11, $12)`,
        [orderId, no, p.sub, total, ship.subtotal, ship.total, CURRENCY, lines.reduce((s, l) => s + l.qty, 0), a.name, a.city, JSON.stringify(a), p.email ?? null],
      );
      const subIds = new Map<string, string>();
      for (const [sellerId, fee] of ship.perSeller) {
        const id = randomUUID();
        subIds.set(sellerId, id);
        const mine = lines.filter((l) => l.sellerId === sellerId);
        await tx.query(
          `INSERT INTO seller_orders (id, order_id, seller_id, seller_name, status, items, total_minor, shipping_minor, placed_at, ship_by) VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', $5, $6, $7, now(), now() + make_interval(hours => $8))`,
          [id, orderId, sellerId, mine[0].sellerName, mine.reduce((s, l) => s + l.qty, 0), mine.reduce((s, l) => s + l.qty * l.unitPriceMinor, 0), fee, SHIP_BY_HOURS],
        );
      }
      for (const l of lines)
        await tx.query(
          `INSERT INTO order_lines (order_id, product_id, offer_id, seller_order_id, title, category, seller_id, seller_name, qty, unit_price_minor) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [orderId, l.productId, l.offerId, subIds.get(l.sellerId), l.title, l.category, l.sellerId, l.sellerName, l.qty, l.unitPriceMinor],
        );
      await tx.query(`INSERT INTO order_events (order_id, from_status, to_status, actor) VALUES ($1, NULL, 'CREATED', $2)`, [orderId, `user:${p.sub}`]);
      const o = (await this.repo.load(tx, orderId))!;
      await this.repo.emit(tx, 'order.created.v1', orderId, { orderId, orderNo: no, buyerId: p.sub, total: { amountMinor: total, currency: CURRENCY }, lines: this.repo.lineEvents(o) });
      return no as string;
    });

    const ttlSec = Number(process.env.CHECKOUT_TTL_SEC ?? 900);
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
    let session: PaymentSession | undefined;
    const actor = 'system:checkout';
    const transition = (to: 'REJECTED' | 'PENDING_PAYMENT', note: string, extra: Record<string, unknown> = {}) =>
      this.db.transaction(async (tx) => {
        const o = (await this.repo.load(tx, orderId, true))!;
        await this.repo.transition(tx, o, to, actor, note, extra);
        if (to === 'REJECTED') await this.repo.sellerAll(tx, o, 'CANCELLED', actor);
        else await this.cart.clear(tx, p.sub, lines.map((l) => l.offerId));
      });

    try {
      await runCheckoutSaga({
        score: () => this.clients.score({ orderId, buyerId: p.sub, totalMinor: total, itemCount: lines.reduce((s, l) => s + l.qty, 0), sellerIds: [...ship.perSeller.keys()], pincode: a.pincode, accountCreatedAt: null }),
        saveRisk: (r) => this.db.query(`UPDATE orders SET risk_decision = $2, risk_score = $3, risk_rules = $4 WHERE id = $1`, [orderId, r.decision, r.score, JSON.stringify(r.rules)]).then(() => {}),
        reserve: () => this.clients.reserve(orderId, lines.map((l) => ({ skuId: l.offerId, qty: l.qty })), ttlSec).then(() => {}),
        release: () => this.clients.release(orderId),
        createPayment: async () => (session = await this.clients.createPayment({ orderId, orderNo, buyerId: p.sub, amountMinor: total, currency: CURRENCY, provider: input.provider, expiresAt }, orderId)),
        reject: (_code, note) => transition('REJECTED', note),
        pending: () => transition('PENDING_PAYMENT', `payment ${session!.paymentId} (${session!.provider})`, { payment_id: session!.paymentId, payment_provider: session!.provider, payment_status: session!.status, payment_expires_at: session!.expiresAt }),
      });
    } catch (e) {
      if (e instanceof SagaRejected) {
        const status = e.code === 'DEPENDENCY_UNAVAILABLE' ? 503 : e.code === 'OUT_OF_STOCK' ? 409 : 422;
        throw new HttpException({ code: e.code, message: e.message, offerIds: e.offerIds }, status);
      }
      this.log.error(`checkout ${orderNo} failed unexpectedly: ${(e as Error).message}`);
      throw e;
    }
    return CheckoutResultSchema.parse({ orderId, orderNo, status: 'PENDING_PAYMENT', totalMinor: total, payment: session });
  }
}
