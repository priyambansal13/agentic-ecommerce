import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ReservationSchema, StockLevelsSchema, TOPICS } from '@ac/contracts';
import { OutboxService } from '@ac/nest-common';
import { DataSource, type EntityManager } from 'typeorm';

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** TypeORM returns [rows, rowCount] for UPDATE/DELETE … RETURNING but plain rows for SELECT/INSERT */
export const rowsOf = (r: any): any[] => (Array.isArray(r) && Array.isArray(r[0]) && typeof r[1] === 'number' ? r[0] : r);

export interface Line { skuId: string; qty: number }
type ReleaseReason = 'EXPIRED' | 'PAYMENT_FAILED' | 'ORDER_CANCELLED';

/**
 * Stock is the source of truth for sellable quantity (sku_id = catalog offer id).
 * Reservation = conditional UPDATE … WHERE on_hand - reserved >= qty per line (lines sorted by sku_id → no deadlocks),
 * all-or-nothing in one transaction; commit on payment, release on failure/cancel/expiry. Every change writes a
 * stock_movements row and, where others care, an outbox event in the same transaction.
 */
@Injectable()
export class StockService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(StockService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: DataSource, private readonly outbox: OutboxService) {}

  onModuleInit() {
    const ms = Number(process.env.RESERVATION_SWEEP_MS ?? 30_000);
    if (ms > 0) this.timer = setInterval(() => void this.sweep().catch((e) => this.log.error(`sweep failed: ${e.message}`)), ms);
  }
  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ reservations
  async reserve(orderId: string, lines: Line[], ttlSec: number) {
    // merge duplicate SKUs, sort to keep a global lock order
    const merged = [...lines.reduce((m, l) => m.set(l.skuId, (m.get(l.skuId) ?? 0) + l.qty), new Map<string, number>())]
      .map(([skuId, qty]) => ({ skuId, qty }))
      .sort((a, b) => a.skuId.localeCompare(b.skuId));
    return this.db.transaction(async (tx) => {
      const existing = rowsOf(await tx.query(`SELECT * FROM reservations WHERE order_id = $1`, [orderId]))[0];
      if (existing) return this.view(existing); // idempotent on orderId
      const failed: string[] = [];
      for (const l of merged) {
        const r = rowsOf(await tx.query(`UPDATE stock SET reserved = reserved + $2, version = version + 1, updated_at = now() WHERE sku_id = $1 AND on_hand - reserved >= $2 RETURNING sku_id`, [l.skuId, l.qty]));
        if (!r.length) failed.push(l.skuId);
      }
      if (failed.length) {
        // undo by throwing → the whole transaction rolls back (nothing reserved)
        throw new ConflictException({ code: 'INSUFFICIENT_STOCK', skuIds: failed });
      }
      const expiresAt = new Date(Date.now() + ttlSec * 1000);
      await tx.query(`INSERT INTO reservations (order_id, status, expires_at) VALUES ($1, 'ACTIVE', $2)`, [orderId, expiresAt]);
      for (const l of merged) {
        await tx.query(`INSERT INTO reservation_lines (order_id, sku_id, qty) VALUES ($1, $2, $3)`, [orderId, l.skuId, l.qty]);
        await this.movement(tx, l.skuId, 0, l.qty, 'RESERVE', orderId);
      }
      await this.outbox.enqueue(tx, { topic: TOPICS.inventory, type: 'inventory.stock_reserved.v1', aggregateId: orderId, data: { orderId, lines: merged, expiresAt: expiresAt.toISOString() } });
      return ReservationSchema.parse({ orderId, status: 'ACTIVE', expiresAt: expiresAt.toISOString() });
    });
  }

  /** payment succeeded → on_hand -= qty, reserved -= qty. Idempotent; a no-op unless ACTIVE. */
  async commit(orderId: string, tx?: EntityManager) {
    const run = async (t: EntityManager) => {
      const res = rowsOf(await t.query(`UPDATE reservations SET status = 'COMMITTED', closed_at = now() WHERE order_id = $1 AND status = 'ACTIVE' RETURNING *`, [orderId]))[0];
      if (!res) return this.current(t, orderId);
      const lines = await this.lines(t, orderId);
      for (const l of lines) {
        const [s] = rowsOf(await t.query(`UPDATE stock SET on_hand = on_hand - $2, reserved = reserved - $2, version = version + 1, updated_at = now() WHERE sku_id = $1 RETURNING seller_id, on_hand - reserved AS available, low_stock_threshold`, [l.skuId, l.qty]));
        await this.movement(t, l.skuId, -l.qty, -l.qty, 'COMMIT', orderId);
        // committing never changes `available` (both drop), but a stock-out shows up here for sellers
        if (s && n(s.available) <= n(s.low_stock_threshold)) await this.lowStock(t, l.skuId, s.seller_id, n(s.available), n(s.low_stock_threshold));
      }
      await this.outbox.enqueue(t, { topic: TOPICS.inventory, type: 'inventory.stock_committed.v1', aggregateId: orderId, data: { orderId, lines } });
      return this.view(res);
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  /** release an ACTIVE reservation (payment failed / order cancelled / expired). Idempotent. */
  async release(orderId: string, reason: ReleaseReason, tx?: EntityManager) {
    const run = async (t: EntityManager) => {
      const status = reason === 'EXPIRED' ? 'EXPIRED' : 'RELEASED';
      const res = rowsOf(await t.query(`UPDATE reservations SET status = $2, closed_at = now() WHERE order_id = $1 AND status = 'ACTIVE' RETURNING *`, [orderId, status]))[0];
      if (!res) return this.current(t, orderId);
      const lines = await this.lines(t, orderId);
      for (const l of lines) {
        await t.query(`UPDATE stock SET reserved = reserved - $2, version = version + 1, updated_at = now() WHERE sku_id = $1`, [l.skuId, l.qty]);
        await this.movement(t, l.skuId, 0, -l.qty, reason === 'EXPIRED' ? 'EXPIRE' : 'RELEASE', orderId);
      }
      await this.outbox.enqueue(t, { topic: TOPICS.inventory, type: 'inventory.reservation_released.v1', aggregateId: orderId, data: { orderId, reason, lines } });
      return this.view(res);
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  /** order cancelled after payment (stock already committed) → put the units back once. */
  async returnCommitted(orderId: string, tx: EntityManager) {
    const res = rowsOf(await tx.query(`UPDATE reservations SET returned_at = now() WHERE order_id = $1 AND status = 'COMMITTED' AND returned_at IS NULL RETURNING *`, [orderId]))[0];
    if (!res) return;
    const lines = await this.lines(tx, orderId);
    for (const l of lines) {
      await tx.query(`UPDATE stock SET on_hand = on_hand + $2, version = version + 1, updated_at = now() WHERE sku_id = $1`, [l.skuId, l.qty]);
      await this.movement(tx, l.skuId, l.qty, 0, 'RETURN', orderId);
    }
  }

  /** expiry sweeper: SKIP LOCKED so several replicas can sweep in parallel without double-releasing */
  async sweep() {
    let total = 0;
    for (;;) {
      const released = await this.db.transaction(async (tx) => {
        const due = rowsOf(await tx.query(`SELECT order_id FROM reservations WHERE status = 'ACTIVE' AND expires_at < now() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED`));
        for (const r of due) await this.release(r.order_id, 'EXPIRED', tx);
        return due.length;
      });
      total += released;
      if (released < 100) break;
    }
    if (total) this.log.log(`expired ${total} reservation(s)`);
    return total;
  }

  async get(orderId: string) {
    const r = rowsOf(await this.db.query(`SELECT * FROM reservations WHERE order_id = $1`, [orderId]))[0];
    if (!r) throw new NotFoundException('No reservation for this order');
    return this.view(r);
  }

  // ------------------------------------------------------------------ stock
  async levels(skuIdsParam: string | undefined) {
    const ids = [...new Set((skuIdsParam ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 100);
    const valid = ids.filter((i) => UUID.test(i));
    const rows = valid.length ? await this.db.query(`SELECT sku_id, greatest(on_hand - reserved, 0) AS available FROM stock WHERE sku_id = ANY($1::uuid[])`, [valid]) : [];
    const by = new Map(rows.map((r: any) => [r.sku_id, n(r.available)]));
    return StockLevelsSchema.parse({ items: valid.map((skuId) => ({ skuId, available: by.get(skuId) ?? 0 })) });
  }

  /** seller sets on-hand for their own SKU (restock or correction) */
  async adjust(sellerId: string, skuId: string, onHand: number) {
    return this.db.transaction(async (tx) => {
      const [s] = rowsOf(await tx.query(`SELECT * FROM stock WHERE sku_id = $1 FOR UPDATE`, [skuId]));
      if (!s) throw new NotFoundException('Unknown SKU');
      if (s.seller_id !== sellerId) throw new ForbiddenException('Not your SKU');
      if (onHand < n(s.reserved)) throw new ConflictException({ code: 'BELOW_RESERVED', message: `${n(s.reserved)} unit(s) are reserved by open orders — on hand cannot go below that` });
      const delta = onHand - n(s.on_hand);
      await tx.query(`UPDATE stock SET on_hand = $2, version = version + 1, updated_at = now() WHERE sku_id = $1`, [skuId, onHand]);
      if (delta) await this.movement(tx, skuId, delta, 0, delta > 0 ? 'RESTOCK' : 'ADJUST', `seller:${sellerId}`);
      const available = onHand - n(s.reserved);
      const was = n(s.on_hand) - n(s.reserved);
      const t = n(s.low_stock_threshold);
      if (available <= t && was > t) await this.lowStock(tx, skuId, sellerId, available, t);
      return { skuId, onHand, reserved: n(s.reserved), available };
    });
  }

  /** catalog.offer_created.v1 → a SKU for the new offer with the seller's declared quantity (idempotent) */
  async createSku(tx: EntityManager, d: { offerId: string; productId: string; sellerId: string; sellerSku: string; title: string; quantity: number }) {
    const ins = rowsOf(await tx.query(
      `INSERT INTO stock (sku_id, product_id, seller_id, sku, title, on_hand, reserved, low_stock_threshold) VALUES ($1, $2, $3, $4, $5, $6, 0, 5)
       ON CONFLICT (sku_id) DO NOTHING RETURNING sku_id`,
      [d.offerId, d.productId, d.sellerId, d.sellerSku, d.title, d.quantity],
    ));
    if (ins.length && d.quantity) await this.movement(tx, d.offerId, d.quantity, 0, 'LISTED', d.offerId);
  }

  // ------------------------------------------------------------------ helpers
  private async lowStock(tx: EntityManager, skuId: string, sellerId: string, available: number, threshold: number) {
    await this.outbox.enqueue(tx, { topic: TOPICS.inventory, type: 'inventory.low_stock.v1', aggregateId: skuId, data: { skuId, sellerId, available: Math.max(available, 0), threshold } });
  }
  private movement(tx: EntityManager, skuId: string, dOnHand: number, dReserved: number, reason: string, ref: string) {
    return tx.query(`INSERT INTO stock_movements (sku_id, delta_on_hand, delta_reserved, reason, ref_id) VALUES ($1, $2, $3, $4, $5)`, [skuId, dOnHand, dReserved, reason, ref]);
  }
  private async lines(tx: EntityManager, orderId: string): Promise<Line[]> {
    const rows = rowsOf(await tx.query(`SELECT sku_id, qty FROM reservation_lines WHERE order_id = $1 ORDER BY sku_id`, [orderId]));
    return rows.map((r: any) => ({ skuId: r.sku_id, qty: n(r.qty) }));
  }
  private async current(tx: EntityManager, orderId: string) {
    const r = rowsOf(await tx.query(`SELECT * FROM reservations WHERE order_id = $1`, [orderId]))[0];
    return r ? this.view(r) : null;
  }
  private view(r: any) {
    return ReservationSchema.parse({ orderId: r.order_id, status: r.status, expiresAt: new Date(r.expires_at).toISOString() });
  }
}
