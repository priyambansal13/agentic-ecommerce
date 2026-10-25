import { Injectable } from '@nestjs/common';
import { type RiskResult, RiskResultSchema, TOPICS } from '@ac/contracts';
import { OutboxService } from '@ac/nest-common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { evaluate } from './rules.js';

const rowsOf = (r: any): any[] => (Array.isArray(r) && Array.isArray(r[0]) && typeof r[1] === 'number' ? r[0] : r);

export interface RiskInput { orderId: string; buyerId: string; totalMinor: number; itemCount: number; sellerIds: string[]; pincode: string; accountCreatedAt: string | null; purpose?: 'checkout' | 'refund' }

@Injectable()
export class RiskService {
  constructor(private readonly db: DataSource, private readonly outbox: OutboxService) {}

  /** Idempotent per order: a retried checkout gets the same decision. REVIEW/BLOCK raise an analyst alert. */
  async score(i: RiskInput): Promise<RiskResult> {
    return this.db.transaction(async (tx) => {
      const [prev] = rowsOf(await tx.query(`SELECT * FROM order_scores WHERE order_id = $1`, [i.orderId]));
      if (prev) return RiskResultSchema.parse({ orderId: i.orderId, decision: prev.decision, score: Number(prev.score), rules: prev.rules });
      // refund agents look the order up: no checkout score (e.g. seeded order) → evaluate the order alone, store
      // nothing and raise no alert, so agent lookups never count as orders in the buyer's velocity
      if (i.purpose === 'refund') {
        const ageDays = i.accountCreatedAt ? (Date.now() - new Date(i.accountCreatedAt).getTime()) / 86_400_000 : null;
        const r = evaluate({ totalMinor: i.totalMinor, itemCount: i.itemCount, sellerCount: new Set(i.sellerIds).size, pincode: i.pincode, accountAgeDays: ageDays, ordersLastHour: 0, priorOrders: 1 });
        return RiskResultSchema.parse({ orderId: i.orderId, ...r });
      }
      const [c] = rowsOf(await tx.query(
        `SELECT count(*) FILTER (WHERE scored_at > now() - interval '1 hour') AS hour, count(*) AS total FROM order_scores WHERE buyer_id = $1`,
        [i.buyerId],
      ));
      const ageDays = i.accountCreatedAt ? (Date.now() - new Date(i.accountCreatedAt).getTime()) / 86_400_000 : null;
      const r = evaluate({ totalMinor: i.totalMinor, itemCount: i.itemCount, sellerCount: new Set(i.sellerIds).size, pincode: i.pincode, accountAgeDays: ageDays, ordersLastHour: Number(c.hour), priorOrders: Number(c.total) });
      await tx.query(`INSERT INTO order_scores (order_id, buyer_id, total_minor, score, decision, rules) VALUES ($1, $2, $3, $4, $5, $6)`, [i.orderId, i.buyerId, i.totalMinor, r.score, r.decision, JSON.stringify(r.rules)]);
      if (r.decision !== 'ALLOW')
        await tx.query(`INSERT INTO alerts (id, subject_type, subject, score, decision, status, rules, raised_at) VALUES ($1, 'ORDER', $2, $3, $4, 'OPEN', $5, now())`, [randomUUID(), `${i.orderId.slice(0, 8)} · ₹${Math.round(i.totalMinor / 100).toLocaleString('en-IN')}`, r.score, r.decision, JSON.stringify(r.rules)]);
      await this.outbox.enqueue(tx, { topic: TOPICS.fraud, type: 'fraud.order_scored.v1', aggregateId: i.orderId, data: { orderId: i.orderId, buyerId: i.buyerId, ...r } });
      return RiskResultSchema.parse({ orderId: i.orderId, ...r });
    });
  }
}
