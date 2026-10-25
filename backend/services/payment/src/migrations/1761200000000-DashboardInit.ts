import type { MigrationInterface, QueryRunner } from 'typeorm';

/** payment service: payments, refunds, seller payouts and the double-entry ledger (own database ac_payments only). */
export class DashboardInit1761200000000 implements MigrationInterface {
  name = 'DashboardInit1761200000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE payments (
        id uuid PRIMARY KEY,
        order_id uuid NOT NULL UNIQUE,
        amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
        currency char(3) NOT NULL,
        status text NOT NULL CHECK (status IN ('REQUIRES_PAYMENT','PROCESSING','SUCCEEDED','FAILED','CANCELED')),
        captured_at timestamptz NOT NULL
      );
      CREATE INDEX payments_captured ON payments (captured_at);
      CREATE TABLE refunds (
        id uuid PRIMARY KEY,
        refund_case_id uuid NOT NULL UNIQUE,
        amount_minor bigint NOT NULL CONSTRAINT refunds_amount_positive CHECK (amount_minor > 0),
        currency char(3) NOT NULL,
        status text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
        created_at timestamptz NOT NULL
      );
      CREATE TABLE payouts (
        id uuid PRIMARY KEY,
        seller_id uuid NOT NULL,
        seller_name text NOT NULL,
        amount_minor bigint NOT NULL CHECK (amount_minor > 0),
        currency char(3) NOT NULL,
        status text NOT NULL CHECK (status IN ('PENDING','PAID','FAILED')),
        scheduled_on date NOT NULL,
        paid_at timestamptz
      );
      CREATE INDEX payouts_status_scheduled ON payouts (status, scheduled_on);
      CREATE TABLE ledger_entries (
        id bigserial PRIMARY KEY,
        tx_id uuid NOT NULL,
        kind text NOT NULL CHECK (kind IN ('CAPTURE','REFUND','PAYOUT','FEE')),
        account text NOT NULL,
        debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
        credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ledger_tx ON ledger_entries (tx_id);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS ledger_entries; DROP TABLE IF EXISTS payouts; DROP TABLE IF EXISTS refunds; DROP TABLE IF EXISTS payments;`);
  }
}
