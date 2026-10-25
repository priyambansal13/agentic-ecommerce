import type { MigrationInterface, QueryRunner } from 'typeorm';

/** fraud: every synchronously scored order (idempotency per order + velocity window). Expand-only. */
export class RiskScores1761600000000 implements MigrationInterface {
  name = 'RiskScores1761600000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE IF NOT EXISTS order_scores (
        order_id uuid PRIMARY KEY,
        buyer_id uuid NOT NULL,
        total_minor bigint NOT NULL,
        score numeric(4,2) NOT NULL,
        decision text NOT NULL CHECK (decision IN ('ALLOW','REVIEW','BLOCK')),
        rules jsonb NOT NULL DEFAULT '[]',
        scored_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS order_scores_buyer_time ON order_scores (buyer_id, scored_at DESC);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS order_scores;`);
  }
}
