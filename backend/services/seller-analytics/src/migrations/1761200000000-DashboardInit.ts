import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * seller-analytics: CQRS read model for the seller dashboard (own database ac_analytics only).
 * In production these tables are maintained by consumers of order/payment/returns events.
 */
export class DashboardInit1761200000000 implements MigrationInterface {
  name = 'DashboardInit1761200000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE daily_sales (
        seller_id uuid NOT NULL,
        day date NOT NULL,
        orders int NOT NULL DEFAULT 0 CHECK (orders >= 0),
        units int NOT NULL DEFAULT 0 CHECK (units >= 0),
        gross_minor bigint NOT NULL DEFAULT 0 CHECK (gross_minor >= 0),
        refunds_minor bigint NOT NULL DEFAULT 0 CHECK (refunds_minor >= 0),
        PRIMARY KEY (seller_id, day)
      );
      CREATE TABLE product_sales (
        seller_id uuid NOT NULL,
        product_id uuid NOT NULL,
        title text NOT NULL,
        units int NOT NULL CHECK (units >= 0),
        gross_minor bigint NOT NULL CHECK (gross_minor >= 0),
        PRIMARY KEY (seller_id, product_id)
      );
      CREATE TABLE seller_payouts (
        payout_id uuid PRIMARY KEY,
        seller_id uuid NOT NULL,
        amount_minor bigint NOT NULL CHECK (amount_minor > 0),
        status text NOT NULL CHECK (status IN ('PENDING','PAID')),
        scheduled_on date NOT NULL,
        paid_at timestamptz
      );
      CREATE INDEX seller_payouts_seller ON seller_payouts (seller_id, scheduled_on DESC);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS seller_payouts; DROP TABLE IF EXISTS product_sales; DROP TABLE IF EXISTS daily_sales;`);
  }
}
