import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationShutdown,
  type OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentSessionSchema, PaymentViewSchema, TOPICS, type PaymentCreateInputSchema, type TestPayInputSchema } from '@ac/contracts';
import type { z } from 'zod';
import { OutboxService, type PrincipalInfo } from '@ac/nest-common';
import { randomUUID, createHash } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { FeesService } from '../fees/fees.service.js';
import { checkCard } from './cards.js';
import { capturePostings, feePostings, feeRows, isBalanced, refundPostings, type PaymentLine, type Posting } from './ledger.js';
import { type NormalizedEvent, type ProviderAdapter, StripeProvider, TestpayProvider } from './providers.js';
import { verify } from './signature.js';

type PaymentCreateInput = z.infer<typeof PaymentCreateInputSchema>;
type TestPayInput = z.infer<typeof TestPayInputSchema>;
const n = (v: unknown) => Number(v ?? 0);
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
/** deterministic uuid (idempotency anchors such as the refund of a cancelled order) */
export const stableUuid = (key: string) => {
  const h = createHash('sha256').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
/** TypeORM raw UPDATE … RETURNING resolves to [rows, count] */
const rowsOf = (r: any): any[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r);

@Injectable()
export class PaymentsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(PaymentsService.name);
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly db: DataSource,
    private readonly outbox: OutboxService,
    private readonly fees: FeesService,
    @Inject(TestpayProvider) private readonly testpay: TestpayProvider,
    @Inject(StripeProvider) private readonly stripe: StripeProvider,
  ) {}

  provider(name: string): ProviderAdapter {
    if (name === 'testpay') return this.testpay;
    if (name === 'stripe') return this.stripe;
    throw new BadRequestException(`unknown provider ${name}`);
  }

  // ───────────────────────────────────────────── sessions
  /** POST /internal/payments — idempotent on orderId. */
  async create(input: PaymentCreateInput) {
    const existing = await this.byOrder(input.orderId);
    if (existing) return this.session(existing);
    const p = this.provider(input.provider);
    if (!p.enabled()) throw new UnprocessableEntityException({ code: 'PROVIDER_UNAVAILABLE', message: `${input.provider} is not configured on this environment` });
    const s = await p.createSession({ orderId: input.orderId, orderNo: input.orderNo, amountMinor: input.amountMinor, currency: input.currency });
    await this.db.query(
      `INSERT INTO payments (id, order_id, amount_minor, currency, status, provider, provider_intent_id, buyer_id, order_no, client_secret, expires_at)
       VALUES ($1, $2, $3, $4, 'REQUIRES_PAYMENT', $5, $6, $7, $8, $9, $10) ON CONFLICT (order_id) DO NOTHING`,
      [randomUUID(), input.orderId, input.amountMinor, input.currency, input.provider, s.providerIntentId, input.buyerId, input.orderNo, s.clientSecret, input.expiresAt],
    );
    return this.session((await this.byOrder(input.orderId))!);
  }

  async view(id: string, who: PrincipalInfo) {
    const row = await this.owned(id, who);
    return PaymentViewSchema.parse({ ...this.session(row), orderId: row.order_id, orderNo: row.order_no, failureReason: row.failure_reason ?? null });
  }

  /** POST /payments/:id/testpay — buyer submits a TEST card; the outcome arrives via the signed webhook. */
  async submitTestCard(id: string, who: PrincipalInfo, card: TestPayInput) {
    const row = await this.owned(id, who);
    if (row.provider !== 'testpay') throw new BadRequestException('This payment does not use the test provider');
    if (row.status !== 'REQUIRES_PAYMENT') throw new ConflictException(`Payment is ${row.status.toLowerCase()}`);
    if (new Date(row.expires_at) <= new Date()) throw new GoneException('This payment session has expired — place the order again');
    const c = checkCard(card.cardNumber, card.expiry);
    if (!c.ok) throw new BadRequestException({ message: c.error === 'EXPIRED' ? 'The card has expired' : 'The card number is not valid', code: c.error });
    const updated = rowsOf(
      await this.db.query(
        `UPDATE payments SET status = 'PROCESSING', method_brand = $2, method_last4 = $3, updated_at = now(), version = version + 1
          WHERE id = $1 AND status = 'REQUIRES_PAYMENT' RETURNING *`,
        [id, c.brand, c.last4],
      ),
    );
    if (!updated.length) throw new ConflictException('Payment was already submitted');
    await this.db.query(`INSERT INTO payment_attempts (id, payment_id, method_brand, method_last4, outcome) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), id, c.brand, c.last4, c.outcome]);
    this.testpay.deliver({
      intentId: row.provider_intent_id,
      amountMinor: n(row.amount_minor),
      succeeded: c.outcome === 'SUCCEEDED',
      brand: c.brand,
      last4: c.last4,
      reason: c.outcome === 'DECLINED' ? 'Your card was declined' : c.outcome === 'INSUFFICIENT_FUNDS' ? 'Insufficient funds' : undefined,
    });
    return this.view(id, who);
  }

  // ───────────────────────────────────────────── webhooks (truth)
  async webhook(providerName: 'testpay' | 'stripe', rawBody: string | undefined, signature: string | undefined) {
    const p = this.provider(providerName);
    if (!p.enabled()) throw new NotFoundException();
    if (!rawBody) throw new BadRequestException('empty body');
    const v = verify(p.webhookSecret(), rawBody, signature);
    if (!v.ok) {
      this.log.warn(`${providerName} webhook rejected: ${v.reason}`);
      throw new BadRequestException({ message: 'invalid signature', reason: v.reason });
    }
    let e: NormalizedEvent;
    try {
      e = p.parse(rawBody);
    } catch {
      throw new BadRequestException('malformed event');
    }
    return this.db.transaction(async (tx) => {
      const [ins] = rowsOf(
        await tx.query(
          `INSERT INTO webhook_events (provider, provider_event_id, type, payload) VALUES ($1, $2, $3, $4)
           ON CONFLICT (provider, provider_event_id) DO UPDATE SET deliveries = webhook_events.deliveries + 1
           RETURNING (xmax = 0) AS inserted`,
          [providerName, e.eventId, e.rawType, rawBody],
        ),
      );
      if (!ins.inserted) return { received: true, duplicate: true };
      const outcome = await this.apply(tx, providerName, e);
      await tx.query(`UPDATE webhook_events SET processed_at = now(), outcome = $3 WHERE provider = $1 AND provider_event_id = $2`, [providerName, e.eventId, outcome]);
      return { received: true, duplicate: false, outcome };
    });
  }

  private async apply(tx: EntityManager, providerName: string, e: NormalizedEvent): Promise<string> {
    if (e.type === 'IGNORED' || e.type === 'REFUNDED') return 'IGNORED';
    const [pay] = await tx.query(`SELECT * FROM payments WHERE provider = $1 AND provider_intent_id = $2 FOR UPDATE`, [providerName, e.providerIntentId]);
    if (!pay) return 'UNKNOWN_INTENT';
    if (e.amountMinor !== null && e.amountMinor !== n(pay.amount_minor)) {
      this.log.error(`amount mismatch on ${pay.id}: webhook ${e.amountMinor} vs ${pay.amount_minor}`);
      return 'AMOUNT_MISMATCH';
    }
    if (e.type === 'FAILED') {
      if (!['REQUIRES_PAYMENT', 'PROCESSING'].includes(pay.status)) return `IGNORED_${pay.status}`;
      await tx.query(
        `UPDATE payments SET status = 'FAILED', failure_reason = $2, method_brand = coalesce($3, method_brand), method_last4 = coalesce($4, method_last4), updated_at = now(), version = version + 1 WHERE id = $1`,
        [pay.id, e.reason ?? 'payment failed', e.brand ?? null, e.last4 ?? null],
      );
      await this.outbox.enqueue(tx, {
        topic: TOPICS.payment,
        type: 'payment.failed.v1',
        aggregateId: pay.order_id,
        data: { paymentId: pay.id, orderId: pay.order_id, reason: e.reason ?? 'payment failed', provider: providerName },
      });
      return 'FAILED';
    }
    // SUCCEEDED
    if (pay.status === 'SUCCEEDED') return 'ALREADY_SUCCEEDED';
    if (pay.status === 'FAILED') this.log.error(`success after failure on ${pay.id} — capturing; review`);
    await tx.query(
      `UPDATE payments SET status = 'SUCCEEDED', captured_at = now(), method_brand = coalesce($2, method_brand), method_last4 = coalesce($3, method_last4), updated_at = now(), version = version + 1 WHERE id = $1`,
      [pay.id, e.brand ?? null, e.last4 ?? null],
    );
    await this.postCapture(tx, pay);
    await this.outbox.enqueue(tx, {
      topic: TOPICS.payment,
      type: 'payment.succeeded.v1',
      aggregateId: pay.order_id,
      data: { paymentId: pay.id, orderId: pay.order_id, amount: { amountMinor: n(pay.amount_minor), currency: pay.currency }, provider: providerName },
    });
    // money captured for an order that was already cancelled (e.g. it expired while the card was processing)
    if (pay.order_cancelled_at) await this.refundInTx(tx, { ...pay, status: 'SUCCEEDED' }, n(pay.amount_minor), stableUuid(`cancel-refund:${pay.order_id}`), 'ORDER_CANCELLED_BEFORE_CAPTURE', 'system', true);
    return 'SUCCEEDED';
  }

  // ───────────────────────────────────────────── ledger
  private async lines(tx: EntityManager, orderId: string): Promise<PaymentLine[]> {
    const rows = await tx.query(`SELECT seller_id, product_id, category, qty, unit_price_minor FROM payment_order_lines WHERE order_id = $1`, [orderId]);
    return rows.map((r: any) => ({ sellerId: r.seller_id, productId: r.product_id, category: r.category, qty: n(r.qty), unitPriceMinor: n(r.unit_price_minor) }));
  }

  private async post(tx: EntityManager, kind: 'CAPTURE' | 'REFUND' | 'FEE', postings: Posting[]) {
    if (!isBalanced(postings)) throw new Error(`unbalanced ${kind} transaction`);
    const txId = randomUUID();
    for (const p of postings) {
      await tx.query(`INSERT INTO ledger_entries (tx_id, kind, account, debit_minor, credit_minor) VALUES ($1, $2, $3, $4, $5)`, [txId, kind, p.account, p.debit, p.credit]);
    }
    return txId;
  }

  /** CAPTURE (+ FEE per seller). Without order lines yet, the capture is parked in suspense and allocated later. */
  private async postCapture(tx: EntityManager, pay: any) {
    const total = n(pay.amount_minor);
    const lines = await this.lines(tx, pay.order_id);
    if (!lines.length) {
      await this.post(tx, 'CAPTURE', [
        { account: 'gateway:clearing', debit: total, credit: 0 },
        { account: 'suspense:unallocated', debit: 0, credit: total },
      ]);
      this.log.warn(`capture for ${pay.order_id} parked in suspense until order.created.v1 arrives`);
      return;
    }
    await this.post(tx, 'CAPTURE', capturePostings(total, lines));
    await this.postFees(tx, pay, lines);
    await tx.query(`UPDATE payments SET allocated_at = now() WHERE id = $1`, [pay.id]);
  }

  /** order lines arrived after the capture: move suspense → sellers/shipping, then fees. */
  async allocateFromSuspense(tx: EntityManager, orderId: string) {
    const [pay] = await tx.query(`SELECT * FROM payments WHERE order_id = $1 AND status = 'SUCCEEDED' AND allocated_at IS NULL FOR UPDATE`, [orderId]);
    if (!pay) return;
    const lines = await this.lines(tx, orderId);
    if (!lines.length) return;
    const total = n(pay.amount_minor);
    const credits = capturePostings(total, lines).filter((p) => p.credit > 0);
    await this.post(tx, 'CAPTURE', [{ account: 'suspense:unallocated', debit: total, credit: 0 }, ...credits]);
    await this.postFees(tx, pay, lines);
    await tx.query(`UPDATE payments SET allocated_at = now() WHERE id = $1`, [pay.id]);
  }

  private async postFees(tx: EntityManager, pay: any, lines: PaymentLine[]) {
    const schedule = await this.fees.active();
    const rows = feeRows(schedule, lines);
    for (const r of rows) {
      await tx.query(
        `INSERT INTO order_fees (order_id, seller_id, product_id, category, sale_minor, referral_minor, closing_minor, payment_minor, gst_minor, currency, schedule_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [pay.order_id, r.sellerId, r.productId, r.category, r.saleMinor, r.referralMinor, r.closingMinor, r.paymentMinor, r.gstMinor, pay.currency, schedule.version],
      );
    }
    for (const postings of feePostings(rows).values()) await this.post(tx, 'FEE', postings);
  }

  // ───────────────────────────────────────────── refunds
  /**
   * Refund within the caller's transaction. Idempotent on refundCaseId. `reverseFees` (full cancellation before
   * shipping) also reverses the marketplace fees. Σ refunds ≤ captured is enforced under the payment row lock.
   */
  async refundInTx(tx: EntityManager, pay: any, amountMinor: number, refundCaseId: string, reason: string, initiatedBy: string, reverseFees = false) {
    const [dup] = await tx.query(`SELECT * FROM refunds WHERE refund_case_id = $1`, [refundCaseId]);
    if (dup) return { refundId: dup.id, status: dup.status, amountMinor: n(dup.amount_minor), duplicate: true };
    if (pay.status !== 'SUCCEEDED') throw new ConflictException({ code: 'NOT_CAPTURED', message: `payment is ${pay.status}` });
    const [{ refunded }] = await tx.query(`SELECT coalesce(sum(amount_minor), 0) AS refunded FROM refunds WHERE payment_id = $1 AND status IN ('PENDING','SUCCEEDED')`, [pay.id]);
    const total = n(pay.amount_minor);
    if (n(refunded) + amountMinor > total) throw new UnprocessableEntityException({ code: 'REFUND_EXCEEDS_CAPTURED', message: `refunds would exceed the captured ${total} (already ${n(refunded)})` });
    const refundId = randomUUID();
    // demo/seeded captures have no provider: they are test money, refunded through testpay
    const { providerRefundId } = await this.provider(pay.provider ?? 'testpay').refund({ providerIntentId: pay.provider_intent_id, amountMinor, refundId });
    await tx.query(
      `INSERT INTO refunds (id, refund_case_id, amount_minor, currency, status, created_at, payment_id, order_id, provider_refund_id, initiated_by, reason)
       VALUES ($1, $2, $3, $4, 'SUCCEEDED', now(), $5, $6, $7, $8, $9)`,
      [refundId, refundCaseId, amountMinor, pay.currency, pay.id, pay.order_id, providerRefundId, initiatedBy, reason],
    );
    const lines = await this.lines(tx, pay.order_id);
    const [cur] = await tx.query(`SELECT allocated_at FROM payments WHERE id = $1`, [pay.id]);
    if (cur?.allocated_at && lines.length) {
      await this.post(tx, 'REFUND', refundPostings(amountMinor, total, lines));
    } else {
      await this.post(tx, 'REFUND', [{ account: 'suspense:unallocated', debit: amountMinor, credit: 0 }, { account: 'gateway:clearing', debit: 0, credit: amountMinor }]);
    }
    if (reverseFees) {
      const fees = await tx.query(`UPDATE order_fees SET reversed_at = now() WHERE order_id = $1 AND reversed_at IS NULL RETURNING *`, [pay.order_id]);
      const rows = rowsOf(fees).map((r: any) => ({ sellerId: r.seller_id, productId: r.product_id, category: r.category, saleMinor: n(r.sale_minor), referralMinor: n(r.referral_minor), closingMinor: n(r.closing_minor), paymentMinor: n(r.payment_minor), gstMinor: n(r.gst_minor) }));
      for (const postings of feePostings(rows, true).values()) await this.post(tx, 'FEE', postings);
    }
    await this.outbox.enqueue(tx, {
      topic: TOPICS.payment,
      type: 'payment.refunded.v1',
      aggregateId: pay.order_id,
      data: { refundId, paymentId: pay.id, orderId: pay.order_id, amount: { amountMinor, currency: pay.currency }, reason },
    });
    return { refundId, status: 'SUCCEEDED', amountMinor, duplicate: false };
  }

  /** POST /internal/refunds — returns service / refund agent (with approval reference). */
  async refund(input: { refundCaseId: string; orderId: string; amountMinor: number; reason: string }, who: PrincipalInfo) {
    return this.db.transaction(async (tx) => {
      const [pay] = await tx.query(`SELECT * FROM payments WHERE order_id = $1 FOR UPDATE`, [input.orderId]);
      if (!pay) throw new NotFoundException('no payment for this order');
      return this.refundInTx(tx, pay, input.amountMinor, input.refundCaseId, input.reason, who.actor ? `${who.actor} (on behalf of ${who.sub})` : `service:${who.sub}`);
    });
  }

  // ───────────────────────────────────────────── order events
  async onOrderCreated(tx: EntityManager, d: { orderId: string; lines: { skuId: string; sellerId: string; qty: number; unitPriceMinor: number; productId?: string; category?: string; title?: string }[] }) {
    for (const l of d.lines) {
      await tx.query(
        `INSERT INTO payment_order_lines (order_id, sku_id, seller_id, product_id, category, title, qty, unit_price_minor) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (order_id, sku_id) DO NOTHING`,
        [d.orderId, l.skuId, l.sellerId, l.productId ?? null, l.category ?? '*', l.title ?? null, l.qty, l.unitPriceMinor],
      );
    }
    await this.allocateFromSuspense(tx, d.orderId);
  }

  async onOrderCancelled(tx: EntityManager, d: { orderId: string; reason: string; refundRequired: boolean }) {
    const [pay] = await tx.query(`SELECT * FROM payments WHERE order_id = $1 FOR UPDATE`, [d.orderId]);
    if (!pay) return;
    await tx.query(`UPDATE payments SET order_cancelled_at = coalesce(order_cancelled_at, now()) WHERE id = $1`, [pay.id]);
    if (pay.status === 'SUCCEEDED') {
      const [{ refunded }] = await tx.query(`SELECT coalesce(sum(amount_minor), 0) AS refunded FROM refunds WHERE payment_id = $1 AND status IN ('PENDING','SUCCEEDED')`, [pay.id]);
      const left = n(pay.amount_minor) - n(refunded);
      if (left > 0) await this.refundInTx(tx, pay, left, stableUuid(`cancel-refund:${d.orderId}`), d.reason, 'system', true);
    } else if (pay.status === 'REQUIRES_PAYMENT') {
      await tx.query(`UPDATE payments SET status = 'CANCELED', failure_reason = $2, updated_at = now(), version = version + 1 WHERE id = $1`, [pay.id, `order cancelled: ${d.reason}`]);
      await this.provider(pay.provider ?? 'testpay').cancel(pay.provider_intent_id);
    }
    // PROCESSING: a success webhook may still arrive → refunded automatically (order_cancelled_at)
  }

  // ───────────────────────────────────────────── expiry sweeper
  onModuleInit() {
    this.sweeper = setInterval(() => void this.expire().catch((e) => this.log.error(`expiry sweep failed: ${e.message}`)), Number(process.env.PAYMENT_SWEEP_MS ?? 30_000));
  }
  onApplicationShutdown() {
    clearInterval(this.sweeper);
  }
  async expire() {
    const rows = rowsOf(
      await this.db.query(
        `UPDATE payments SET status = 'CANCELED', failure_reason = 'payment session expired', updated_at = now(), version = version + 1
          WHERE id IN (SELECT id FROM payments WHERE status = 'REQUIRES_PAYMENT' AND expires_at < now() ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED)
          RETURNING provider, provider_intent_id`,
      ),
    );
    for (const r of rows) await this.provider(r.provider ?? 'testpay').cancel(r.provider_intent_id);
    return rows.length;
  }

  // ───────────────────────────────────────────── helpers
  private async byOrder(orderId: string) {
    const [row] = await this.db.query(`SELECT * FROM payments WHERE order_id = $1`, [orderId]);
    return row as any;
  }

  private async owned(id: string, who: PrincipalInfo) {
    const [row] = await this.db.query(`SELECT * FROM payments WHERE id = $1 AND provider IS NOT NULL`, [id]);
    if (!row) throw new NotFoundException('payment not found');
    const staff = who.roles.includes('admin') || who.roles.includes('support');
    if (row.buyer_id !== who.sub && !staff) throw new ForbiddenException('not your payment');
    return row;
  }

  private session(row: any) {
    return PaymentSessionSchema.parse({
      paymentId: row.id,
      provider: row.provider,
      amountMinor: n(row.amount_minor),
      currency: row.currency,
      status: row.status,
      clientSecret: row.client_secret ?? null,
      publishableKey: row.provider === 'stripe' ? (process.env.STRIPE_PUBLISHABLE_KEY ?? null) : null,
      expiresAt: iso(row.expires_at),
    });
  }
}
