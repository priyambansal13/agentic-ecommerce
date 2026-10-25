import { BadRequestException, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { type Cart, CartSchema } from '@ac/contracts';
import { DependencyError } from '@ac/nest-common';
import { DataSource, type EntityManager } from 'typeorm';
import { CommerceClients, type Offer } from './clients.js';
import { FREE_SHIPPING_OVER_MINOR, shippingFor } from './lifecycle.js';

const CURRENCY = 'INR';
const GUEST_TTL_SEC = 7 * 86_400;
const SID = /^[0-9a-f]{32}$/;
const MAX_QTY = 10;
const MAX_LINES = 50;

/** Who owns the cart: a signed-in customer (by token sub) or a guest session id (7-day sliding TTL). Both live in
 *  the order service's own database (guest_cart_items has expires_at; expired rows are swept). */
export type CartOwner = { kind: 'buyer'; id: string } | { kind: 'guest'; id: string };
export interface StoredItem { offerId: string; qty: number; addedPriceMinor: number; addedAt: string }

export function guestOwner(sid: string | undefined): CartOwner {
  if (!sid || !SID.test(sid)) throw new BadRequestException('X-Cart-Session must be 32 hex characters (or sign in)');
  return { kind: 'guest', id: sid };
}

@Injectable()
export class CartService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(CartService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: DataSource, private readonly clients: CommerceClients) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.db.query(`DELETE FROM guest_cart_items WHERE expires_at < now()`).catch(() => {}), 3_600_000);
  }
  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ storage
  async items(owner: CartOwner, tx: EntityManager | DataSource = this.db): Promise<StoredItem[]> {
    const rows =
      owner.kind === 'guest'
        ? await tx.query(`SELECT offer_id, qty, added_price_minor, added_at FROM guest_cart_items WHERE session_id = $1 AND expires_at > now() ORDER BY added_at`, [owner.id])
        : await tx.query(`SELECT offer_id, qty, added_price_minor, added_at FROM cart_items WHERE buyer_id = $1 ORDER BY added_at`, [owner.id]);
    return rows.map((r: any) => ({ offerId: r.offer_id, qty: Number(r.qty), addedPriceMinor: Number(r.added_price_minor), addedAt: new Date(r.added_at).toISOString() }));
  }

  private async put(owner: CartOwner, item: StoredItem) {
    if (owner.kind === 'guest') {
      await this.db.query(
        `INSERT INTO guest_cart_items (session_id, offer_id, qty, added_price_minor, added_at, expires_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
         ON CONFLICT (session_id, offer_id) DO UPDATE SET qty = EXCLUDED.qty, expires_at = EXCLUDED.expires_at`,
        [owner.id, item.offerId, item.qty, item.addedPriceMinor, item.addedAt, GUEST_TTL_SEC],
      );
      // sliding TTL for the whole guest cart
      await this.db.query(`UPDATE guest_cart_items SET expires_at = now() + make_interval(secs => $2) WHERE session_id = $1`, [owner.id, GUEST_TTL_SEC]);
      return;
    }
    await this.db.query(
      `INSERT INTO cart_items (buyer_id, offer_id, qty, added_price_minor, added_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (buyer_id, offer_id) DO UPDATE SET qty = EXCLUDED.qty`,
      [owner.id, item.offerId, item.qty, item.addedPriceMinor, item.addedAt],
    );
  }

  private async remove(owner: CartOwner, offerId: string) {
    if (owner.kind === 'guest') await this.db.query(`DELETE FROM guest_cart_items WHERE session_id = $1 AND offer_id = $2`, [owner.id, offerId]);
    else await this.db.query(`DELETE FROM cart_items WHERE buyer_id = $1 AND offer_id = $2`, [owner.id, offerId]);
  }

  /** remove the checked-out offers from a buyer's cart (inside the checkout transaction) */
  async clear(tx: EntityManager, buyerId: string, offerIds: string[]) {
    await tx.query(`DELETE FROM cart_items WHERE buyer_id = $1 AND offer_id = ANY($2::uuid[])`, [buyerId, offerIds]);
  }

  /** put lines of a failed/expired order back so the buyer can retry (never overwrites newer cart lines) */
  async restore(tx: EntityManager, buyerId: string, lines: { offerId: string; qty: number; unitPriceMinor: number }[]) {
    for (const l of lines)
      await tx.query(`INSERT INTO cart_items (buyer_id, offer_id, qty, added_price_minor) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [buyerId, l.offerId, Math.min(l.qty, MAX_QTY), l.unitPriceMinor]);
  }

  // ------------------------------------------------------------------ commands
  async add(owner: CartOwner, offerId: string, qty: number) {
    let offer: Offer | undefined;
    try {
      offer = (await this.clients.offers([offerId])).get(offerId);
    } catch {
      throw new ServiceUnavailableException({ code: 'DEPENDENCY_UNAVAILABLE', message: 'The catalogue is temporarily unavailable — try again in a moment.' });
    }
    if (!offer?.active) throw new UnprocessableEntityException({ code: 'OFFER_UNAVAILABLE', message: 'This offer is not available any more.', offerIds: [offerId] });
    const current = await this.items(owner);
    const existing = current.find((i) => i.offerId === offerId);
    if (!existing && current.length >= MAX_LINES) throw new UnprocessableEntityException({ code: 'CART_FULL', message: `A cart holds at most ${MAX_LINES} different items.` });
    await this.put(owner, { offerId, qty: Math.min((existing?.qty ?? 0) + qty, MAX_QTY), addedPriceMinor: existing?.addedPriceMinor ?? offer.priceMinor, addedAt: existing?.addedAt ?? new Date().toISOString() });
    return this.view(owner);
  }

  async setQty(owner: CartOwner, offerId: string, qty: number) {
    const existing = (await this.items(owner)).find((i) => i.offerId === offerId);
    if (existing) {
      if (qty === 0) await this.remove(owner, offerId);
      else await this.put(owner, { ...existing, qty: Math.min(qty, MAX_QTY) });
    }
    return this.view(owner);
  }

  async delete(owner: CartOwner, offerId: string) {
    await this.remove(owner, offerId);
    return this.view(owner);
  }

  /** move a guest cart into the signed-in buyer's cart (quantities add up, capped) and drop the guest cart */
  async merge(buyerId: string, sid: string) {
    const guest = guestOwner(sid);
    const buyer: CartOwner = { kind: 'buyer', id: buyerId };
    const [g, b] = await Promise.all([this.items(guest), this.items(buyer)]);
    const mine = new Map(b.map((i) => [i.offerId, i]));
    for (const i of g) {
      const m = mine.get(i.offerId);
      await this.put(buyer, m ? { ...m, qty: Math.min(m.qty + i.qty, MAX_QTY) } : i);
    }
    await this.db.query(`DELETE FROM guest_cart_items WHERE session_id = $1`, [guest.id]);
    return this.view(buyer);
  }

  // ------------------------------------------------------------------ priced view
  /** Live re-pricing from catalog + availability from inventory; degrades to UNAVAILABLE lines instead of failing. */
  async view(owner: CartOwner): Promise<Cart> {
    const items = await this.items(owner);
    const ids = items.map((i) => i.offerId);
    let offers = new Map<string, Offer>();
    let stock = new Map<string, number>();
    let degraded = false;
    if (ids.length) {
      const [o, s] = await Promise.allSettled([this.clients.offers(ids), this.clients.stock(ids)]);
      if (o.status === 'fulfilled') offers = o.value;
      else degraded = true;
      if (s.status === 'fulfilled') stock = s.value;
      else degraded = true;
      if (degraded) this.log.warn(`cart degraded: ${[o, s].filter((x) => x.status === 'rejected').map((x) => ((x as PromiseRejectedResult).reason as DependencyError).message).join('; ')}`);
    }
    const lines = items.map((i) => {
      const o = offers.get(i.offerId);
      const available = stock.get(i.offerId) ?? 0;
      const price = o?.priceMinor ?? i.addedPriceMinor;
      const status = !o || !o.active || degraded ? 'UNAVAILABLE' : available < i.qty ? 'OUT_OF_STOCK' : price !== i.addedPriceMinor ? 'PRICE_CHANGED' : available - i.qty < 3 ? 'LOW_STOCK' : 'OK';
      return {
        offerId: i.offerId,
        productId: o?.productId ?? '00000000-0000-4000-8000-000000000000',
        title: o?.title ?? 'Item unavailable',
        category: o?.category ?? 'other',
        sellerId: o?.sellerId ?? '00000000-0000-4000-8000-000000000000',
        sellerName: o?.sellerName ?? '—',
        qty: i.qty,
        unitPriceMinor: price,
        mrpMinor: o?.mrpMinor ?? null,
        addedPriceMinor: i.addedPriceMinor,
        available,
        status: status as 'OK' | 'PRICE_CHANGED' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNAVAILABLE',
        lineTotalMinor: price * i.qty,
      };
    });
    const buyable = lines.filter((l) => l.status !== 'UNAVAILABLE' && l.status !== 'OUT_OF_STOCK');
    const ship = shippingFor(buyable);
    return CartSchema.parse({
      currency: CURRENCY,
      lines,
      itemCount: lines.reduce((s, l) => s + l.qty, 0),
      subtotalMinor: ship.subtotal,
      shippingMinor: ship.total,
      totalMinor: ship.subtotal + ship.total,
      taxIncluded: true,
      canCheckout: lines.length > 0 && buyable.length === lines.length,
      freeShippingOverMinor: FREE_SHIPPING_OVER_MINOR,
    });
  }
}
