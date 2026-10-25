import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type CloudEvent, type EventData, Events, type EventType, TOPICS } from '@ac/contracts';
import { EventConsumerService, OutboxService } from '@ac/nest-common';
import { emitOfferUpdates } from './offers.service.js';
import type { EntityManager } from 'typeorm';

/**
 * Keeps the catalog's local read models current (idempotent; processed_events dedupe in the same tx):
 *  user.seller_verified.v1 / user.category_approved.v1 → seller_eligibility
 *  admin.moderation_decided.v1 → product PUBLISHED | REJECTED, creator offer ACTIVE | INACTIVE
 */
@Injectable()
export class MarketplaceEvents implements OnModuleInit {
  private readonly log = new Logger(MarketplaceEvents.name);
  constructor(private readonly events: EventConsumerService, private readonly outbox: OutboxService) {}

  async onModuleInit() {
    await this.events.subscribe('catalog-sellers', [TOPICS.user], (e, tx) => this.onUserEvent(e, tx));
    await this.events.subscribe('catalog-moderation', [TOPICS.admin], (e, tx) => this.onAdminEvent(e, tx));
  }

  /** Invalid events are logged and skipped (recorded as processed) so one bad message cannot block the partition. */
  private parse<T extends EventType>(type: T, evt: CloudEvent): { data: EventData<T> } | null {
    const r = Events[type].safeParse(evt);
    if (!r.success) this.log.error(`skipping invalid ${type} ${evt.id}: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    return r.success ? { data: r.data.data as EventData<T> } : null;
  }

  async onUserEvent(evt: CloudEvent, tx: EntityManager) {
    if (evt.type === 'user.seller_verified.v1') {
      const e = this.parse('user.seller_verified.v1', evt);
      if (!e) return;
      const { data } = e;
      await tx.query(
        `INSERT INTO seller_eligibility (seller_id, display_name, verified) VALUES ($1, $2, true)
         ON CONFLICT (seller_id) DO UPDATE SET display_name = EXCLUDED.display_name, verified = true, updated_at = now()`,
        [data.sellerId, data.displayName],
      );
    } else if (evt.type === 'user.category_approved.v1') {
      const e = this.parse('user.category_approved.v1', evt);
      if (!e) return;
      const { data } = e;
      await tx.query(
        `INSERT INTO seller_eligibility (seller_id, display_name, approved_categories) VALUES ($1, 'Seller', ARRAY[$2]::text[])
         ON CONFLICT (seller_id) DO UPDATE SET approved_categories = array(SELECT DISTINCT unnest(seller_eligibility.approved_categories || ARRAY[$2]::text[])), updated_at = now()`,
        [data.sellerId, data.category],
      );
    }
  }

  async onAdminEvent(evt: CloudEvent, tx: EntityManager) {
    if (evt.type !== 'admin.moderation_decided.v1') return;
    const e = this.parse('admin.moderation_decided.v1', evt);
    if (!e) return;
    const { data } = e;
    const published = data.decision === 'APPROVE';
    const [[p]] = await tx.query( // UPDATE … RETURNING → [rows, rowCount]
      `UPDATE products SET status = $2, moderation_note = $3, version = version + 1 WHERE id = $1 AND status = 'PENDING_REVIEW' RETURNING coalesce(created_by, seller_id) AS creator`,
      [data.productId, published ? 'PUBLISHED' : 'REJECTED', data.note || null],
    );
    if (!p) return this.log.warn(`moderation decision for ${data.productId} ignored (unknown or not pending)`);
    const [rows] = await tx.query(
      `UPDATE offers SET status = $3 WHERE product_id = $1 AND seller_id = $2 AND status = 'PENDING_PRODUCT' RETURNING id, product_id, seller_id, price_minor, status`,
      [data.productId, p.creator, published ? 'ACTIVE' : 'INACTIVE'],
    );
    await emitOfferUpdates(this.outbox, tx, rows);
  }
}
