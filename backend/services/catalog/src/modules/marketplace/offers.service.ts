import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { OfferLookupSchema, TOPICS } from '@ac/contracts';
import { OutboxService } from '@ac/nest-common';
import { DataSource, type EntityManager } from 'typeorm';

const n = (v: unknown) => Number(v ?? 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Emit catalog.offer_updated.v1 for offers whose price/active state changed (call inside the writing transaction). */
export async function emitOfferUpdates(outbox: OutboxService, tx: EntityManager, rows: { id: string; product_id: string; seller_id: string; price_minor: unknown; status: string }[]) {
  for (const r of rows)
    await outbox.enqueue(tx, {
      topic: TOPICS.catalog,
      type: 'catalog.offer_updated.v1',
      aggregateId: r.product_id,
      data: { offerId: r.id, productId: r.product_id, sellerId: r.seller_id, priceMinor: n(r.price_minor), active: r.status === 'ACTIVE' },
    });
}

/** Offer reads for cart/checkout re-pricing (public) and the seller's own price/availability edits. */
@Injectable()
export class OffersService {
  constructor(private readonly db: DataSource, private readonly outbox: OutboxService) {}

  /** GET /offers?ids=a,b — current price + whether it can be bought (offer ACTIVE and product PUBLISHED). */
  async lookup(idsParam: string | undefined) {
    const ids = [...new Set((idsParam ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('ids is required (comma-separated offer ids)');
    if (ids.length > 50) throw new BadRequestException('at most 50 ids');
    if (ids.some((i) => !UUID.test(i))) throw new BadRequestException('ids must be UUIDs');
    const rows = await this.db.query(
      `SELECT o.id, o.product_id, p.title, p.category, o.seller_id, coalesce(e.display_name, 'Seller') AS seller_name, o.price_minor, o.mrp_minor,
              (o.status = 'ACTIVE' AND p.status = 'PUBLISHED') AS active
         FROM offers o JOIN products p ON p.id = o.product_id LEFT JOIN seller_eligibility e ON e.seller_id = o.seller_id
        WHERE o.id = ANY($1::uuid[])`,
      [ids],
    );
    return OfferLookupSchema.parse({
      currency: 'INR',
      items: rows.map((r: any) => ({ offerId: r.id, productId: r.product_id, title: r.title, category: r.category, sellerId: r.seller_id, sellerName: r.seller_name, priceMinor: n(r.price_minor), mrpMinor: r.mrp_minor ? n(r.mrp_minor) : null, active: Boolean(r.active) })),
    });
  }

  /** PATCH /offers/:id — owner seller changes price and/or pauses/resumes the offer. */
  async update(sellerId: string, offerId: string, body: { priceMinor?: number; active?: boolean }) {
    return this.db.transaction(async (tx) => {
      const [o] = await tx.query(`SELECT * FROM offers WHERE id = $1 FOR UPDATE`, [offerId]);
      if (!o) throw new NotFoundException('Unknown offer');
      if (o.seller_id !== sellerId) throw new ForbiddenException('Not your offer');
      if (o.status === 'PENDING_PRODUCT' && body.active !== undefined) throw new UnprocessableEntityException({ code: 'PRODUCT_NOT_PUBLISHED', message: 'The product is still in moderation' });
      const price = body.priceMinor ?? n(o.price_minor);
      if (o.mrp_minor && price > n(o.mrp_minor)) throw new UnprocessableEntityException({ code: 'PRICE_ABOVE_MRP', message: `Price cannot exceed the MRP (${n(o.mrp_minor) / 100})` });
      const status = body.active === undefined ? o.status : body.active ? 'ACTIVE' : 'INACTIVE';
      if (price === n(o.price_minor) && status === o.status) return { offerId, priceMinor: price, status };
      const [[row]] = await tx.query(`UPDATE offers SET price_minor = $2, status = $3 WHERE id = $1 RETURNING id, product_id, seller_id, price_minor, status`, [offerId, price, status]);
      await emitOfferUpdates(this.outbox, tx, [row]);
      return { offerId, priceMinor: price, status };
    });
  }
}
