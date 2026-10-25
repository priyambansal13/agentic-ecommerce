import type { MigrationInterface, QueryRunner } from 'typeorm';

/** returns service: refund cases (own database ac_returns only). */
export class DashboardInit1761200000000 implements MigrationInterface {
  name = 'DashboardInit1761200000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE refund_cases (
        id uuid PRIMARY KEY,
        order_id uuid NOT NULL,
        order_no text NOT NULL,
        buyer_id uuid NOT NULL,
        seller_id uuid NOT NULL,
        reason text NOT NULL CHECK (reason IN ('DAMAGED','WRONG_ITEM','NOT_AS_DESCRIBED','NOT_DELIVERED','CHANGED_MIND','LATE')),
        status text NOT NULL CHECK (status IN ('REQUESTED','GATHERING_EVIDENCE','AWAITING_BUYER','PROPOSED','AUTO_APPROVED','PENDING_HUMAN','APPROVED','REJECTED','REFUND_PENDING','REFUNDED','CLOSED')),
        requested_minor bigint NOT NULL CHECK (requested_minor > 0),
        proposed_minor bigint CHECK (proposed_minor IS NULL OR proposed_minor >= 0),
        approved_minor bigint CHECK (approved_minor IS NULL OR approved_minor >= 0),
        currency char(3) NOT NULL DEFAULT 'INR',
        risk_score numeric(4,2) CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 1),
        required_role text CHECK (required_role IS NULL OR required_role IN ('support','finance')),
        agent_rationale text,
        opened_at timestamptz NOT NULL,
        resolved_at timestamptz
      );
      CREATE INDEX refund_cases_buyer ON refund_cases (buyer_id, opened_at DESC);
      CREATE INDEX refund_cases_queue ON refund_cases (status, required_role, opened_at);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS refund_cases;`);
  }
}
