import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { type CloudEvent, type DecisionInput, Events, TOPICS } from '@ac/contracts';
import { EventConsumerService, OutboxService } from '@ac/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { AUTO_APPROVE_CONFIDENCE, prescreen } from './prescreen.js';

/**
 * Listing moderation: catalog.product_submitted.v1 → pre-screen → auto-approve (agent) or queue for a moderator;
 * every decision → admin.moderation_decided.v1 (outbox), which the catalog applies to the product.
 */
@Injectable()
export class ModerationService implements OnModuleInit {
  private readonly log = new Logger(ModerationService.name);

  constructor(private readonly db: DataSource, private readonly outbox: OutboxService, private readonly events: EventConsumerService) {}

  onModuleInit() {
    return this.events.subscribe('admin-listings', [TOPICS.catalog], (e, tx) => this.onCatalogEvent(e, tx));
  }

  async onCatalogEvent(evt: CloudEvent, tx: EntityManager) {
    if (evt.type !== 'catalog.product_submitted.v1') return;
    const parsed = Events['catalog.product_submitted.v1'].safeParse(evt);
    if (!parsed.success) return this.log.error(`skipping invalid catalog.product_submitted.v1 ${evt.id}: ${parsed.error.message}`); // never block the partition
    const { data } = parsed.data;
    const s = prescreen(data);
    const auto = s.verdict === 'APPROVE' && s.confidence >= AUTO_APPROVE_CONFIDENCE;
    const id = randomUUID();
    await tx.query(
      `INSERT INTO moderation_items (id, product_id, title, seller_id, seller_name, agent_verdict, confidence, reasons, status, decided_by, created_at, decided_at, brand, category, decision_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12, $13, $14)`,
      [id, data.productId, data.title, data.sellerId, data.sellerName, s.verdict, s.confidence, JSON.stringify(s.reasons), auto ? 'APPROVED' : 'PENDING', auto ? 'agent' : null, auto ? new Date() : null, data.brand, data.category, auto ? 'Auto-approved by listing pre-screen' : null],
    );
    if (auto) await this.publish(tx, data.productId, 'APPROVE', 'Auto-approved by listing pre-screen', 'agent');
    this.log.log(`listing ${data.productId}: ${s.verdict} (${s.confidence})${auto ? ' — auto-approved' : ' — queued for a moderator'}`);
  }

  /** POST /moderation/:itemId/decision — moderator; REQUEST_CHANGES is a rejection with a note for the seller. */
  async decide(itemId: string, d: DecisionInput, actor: string) {
    const approve = d.decision === 'APPROVE';
    if (!approve && !d.note) throw new BadRequestException('Tell the seller why (note) when rejecting or requesting changes');
    return this.db.transaction(async (tx) => {
      const [[item]] = await tx.query( // UPDATE … RETURNING → [rows, rowCount]
        `UPDATE moderation_items SET status = $3, decided_by = 'human', decided_by_user = $4, decided_at = now(), decision_note = $5, version = version + 1
          WHERE id = $1 AND version = $2 AND status = 'PENDING' RETURNING id, product_id, status, version`,
        [itemId, d.version, approve ? 'APPROVED' : 'REJECTED', actor, d.note || null],
      );
      if (!item) {
        const [cur] = await tx.query(`SELECT status, version FROM moderation_items WHERE id = $1`, [itemId]);
        if (!cur) throw new NotFoundException('Unknown moderation item');
        throw new ConflictException(cur.status !== 'PENDING' ? `Already decided (${cur.status})` : `Changed since you opened it (now version ${cur.version}) — reload`);
      }
      const note = d.decision === 'REQUEST_CHANGES' ? `Changes requested: ${d.note}` : d.note || (approve ? 'Approved by moderator' : '');
      await this.publish(tx, item.product_id, approve ? 'APPROVE' : 'REJECT', note, 'human');
      return { itemId: item.id, productId: item.product_id, status: item.status, version: item.version };
    });
  }

  private publish(tx: EntityManager, productId: string, decision: 'APPROVE' | 'REJECT', note: string, decidedBy: 'agent' | 'human') {
    return this.outbox.enqueue(tx, { topic: TOPICS.admin, type: 'admin.moderation_decided.v1', aggregateId: productId, data: { productId, decision, note, decidedBy } });
  }
}
