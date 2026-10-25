import type { MigrationInterface, QueryRunner } from 'typeorm';

/** admin service: moderation queue, disputes, seller sanctions (own database ac_admin only). */
export class DashboardInit1761200000000 implements MigrationInterface {
  name = 'DashboardInit1761200000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE moderation_items (
        id uuid PRIMARY KEY,
        product_id uuid NOT NULL,
        title text NOT NULL,
        seller_id uuid NOT NULL,
        seller_name text NOT NULL,
        agent_verdict text NOT NULL CHECK (agent_verdict IN ('APPROVE','NEEDS_REVIEW','REJECT')),
        confidence numeric(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
        reasons jsonb NOT NULL DEFAULT '[]',
        status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
        decided_by text CHECK (decided_by IS NULL OR decided_by IN ('agent','human')),
        created_at timestamptz NOT NULL,
        decided_at timestamptz
      );
      CREATE INDEX moderation_items_status ON moderation_items (status, created_at);
      CREATE TABLE disputes (
        id uuid PRIMARY KEY,
        order_no text NOT NULL,
        status text NOT NULL CHECK (status IN ('OPEN','AWAITING_SELLER','RESOLVED')),
        opened_at timestamptz NOT NULL
      );
      CREATE TABLE seller_sanctions (
        seller_id uuid PRIMARY KEY,
        reason text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS seller_sanctions; DROP TABLE IF EXISTS disputes; DROP TABLE IF EXISTS moderation_items;`);
  }
}
