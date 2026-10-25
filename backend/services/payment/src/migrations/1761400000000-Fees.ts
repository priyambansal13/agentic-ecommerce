import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * payment service (own database ac_payments): versioned marketplace fee schedules (maker-checker) and the fees
 * charged per order line (commission ledger detail; the double-entry FEE transactions live in ledger_entries).
 */
export class Fees1761400000000 implements MigrationInterface {
  name = 'Fees1761400000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE fee_schedules (
        id uuid PRIMARY KEY,
        version int NOT NULL UNIQUE,
        status text NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','RETIRED','REJECTED')),
        effective_from timestamptz,
        payment_fee_bps int NOT NULL CHECK (payment_fee_bps BETWEEN 0 AND 1000),
        gst_bps int NOT NULL CHECK (gst_bps BETWEEN 0 AND 3000),
        rules jsonb NOT NULL,
        note text,
        created_by text NOT NULL,
        created_by_name text NOT NULL,
        submitted_by text,
        submitted_by_name text,
        approved_by text,
        approved_by_name text,
        created_at timestamptz NOT NULL DEFAULT now(),
        approved_at timestamptz,
        row_version int NOT NULL DEFAULT 1
      );
      CREATE UNIQUE INDEX fee_schedules_one_active ON fee_schedules ((true)) WHERE status = 'ACTIVE';
      CREATE UNIQUE INDEX fee_schedules_one_open ON fee_schedules ((true)) WHERE status IN ('DRAFT','PENDING_APPROVAL');
      CREATE TABLE order_fees (
        id bigserial PRIMARY KEY,
        order_id uuid NOT NULL,
        seller_id uuid NOT NULL,
        product_id uuid,
        category text NOT NULL,
        sale_minor bigint NOT NULL CHECK (sale_minor >= 0),
        referral_minor bigint NOT NULL CHECK (referral_minor >= 0),
        closing_minor bigint NOT NULL CHECK (closing_minor >= 0),
        payment_minor bigint NOT NULL CHECK (payment_minor >= 0),
        gst_minor bigint NOT NULL CHECK (gst_minor >= 0),
        currency char(3) NOT NULL,
        schedule_version int NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX order_fees_seller_created ON order_fees (seller_id, created_at);
      CREATE INDEX order_fees_created ON order_fees (created_at);
      CREATE INDEX order_fees_order ON order_fees (order_id);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS order_fees; DROP TABLE IF EXISTS fee_schedules;`);
  }
}
