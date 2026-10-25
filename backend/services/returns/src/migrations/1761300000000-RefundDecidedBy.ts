import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Expand-only: who decided a case (agent inside its policy envelope, or a human). Nullable → safe for running pods. */
export class RefundDecidedBy1761300000000 implements MigrationInterface {
  name = 'RefundDecidedBy1761300000000';

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE refund_cases ADD COLUMN IF NOT EXISTS decided_by text CHECK (decided_by IN ('agent', 'human'))`);
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE refund_cases DROP COLUMN IF EXISTS decided_by`);
  }
}
