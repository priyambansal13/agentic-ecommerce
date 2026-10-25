import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * payment service (own database ac_payments): P2 payments — provider sessions (testpay, stripe), attempts,
 * webhook inbox (dedupe on provider event id), order lines for fee allocation, refunds per LLD.
 * Additive: new nullable columns; seeded dashboard rows stay valid. captured_at becomes nullable (set on capture).
 */
export class Payments1761600000000 implements MigrationInterface {
  name = 'Payments1761600000000';

  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE payments ALTER COLUMN captured_at DROP NOT NULL;
      ALTER TABLE payments ADD COLUMN provider text CHECK (provider IN ('testpay','stripe','razorpay','stub'));
      ALTER TABLE payments ADD COLUMN provider_intent_id text UNIQUE;
      ALTER TABLE payments ADD COLUMN buyer_id uuid;
      ALTER TABLE payments ADD COLUMN order_no text;
      ALTER TABLE payments ADD COLUMN client_secret text;
      ALTER TABLE payments ADD COLUMN expires_at timestamptz;
      ALTER TABLE payments ADD COLUMN failure_reason text;
      ALTER TABLE payments ADD COLUMN method_brand text;
      ALTER TABLE payments ADD COLUMN method_last4 char(4);
      ALTER TABLE payments ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE payments ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE payments ADD COLUMN version int NOT NULL DEFAULT 1;
      CREATE INDEX payments_open_expiry ON payments (expires_at) WHERE status = 'REQUIRES_PAYMENT';
      CREATE INDEX payments_buyer ON payments (buyer_id);

      CREATE TABLE payment_attempts (
        id uuid PRIMARY KEY,
        payment_id uuid NOT NULL REFERENCES payments(id),
        method_brand text,
        method_last4 char(4),
        outcome text NOT NULL CHECK (outcome IN ('SUBMITTED','SUCCEEDED','DECLINED','INSUFFICIENT_FUNDS','ERROR')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX payment_attempts_payment ON payment_attempts (payment_id);

      CREATE TABLE webhook_events (
        provider text NOT NULL,
        provider_event_id text NOT NULL,
        type text NOT NULL,
        payload jsonb NOT NULL,
        deliveries int NOT NULL DEFAULT 1,
        received_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        outcome text,
        PRIMARY KEY (provider, provider_event_id)
      );

      -- order lines from order.created.v1 (local read model) → fee allocation + ledger per seller
      CREATE TABLE payment_order_lines (
        order_id uuid NOT NULL,
        sku_id uuid NOT NULL,
        seller_id uuid NOT NULL,
        product_id uuid,
        category text NOT NULL,
        title text,
        qty int NOT NULL CHECK (qty > 0),
        unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
        PRIMARY KEY (order_id, sku_id)
      );

      ALTER TABLE refunds ADD COLUMN payment_id uuid REFERENCES payments(id);
      ALTER TABLE refunds ADD COLUMN order_id uuid;
      ALTER TABLE refunds ADD COLUMN provider_refund_id text;
      ALTER TABLE refunds ADD COLUMN initiated_by text;
      ALTER TABLE refunds ADD COLUMN reason text;
      CREATE INDEX refunds_payment ON refunds (payment_id);

      -- fees reversed when an order is cancelled before shipping (row kept for audit, excluded from totals)
      ALTER TABLE order_fees ADD COLUMN reversed_at timestamptz;`);
  }

  async down(q: QueryRunner) {
    await q.query(`
      ALTER TABLE order_fees DROP COLUMN IF EXISTS reversed_at;
      ALTER TABLE refunds DROP COLUMN IF EXISTS reason, DROP COLUMN IF EXISTS initiated_by, DROP COLUMN IF EXISTS provider_refund_id,
        DROP COLUMN IF EXISTS order_id, DROP COLUMN IF EXISTS payment_id;
      DROP TABLE IF EXISTS payment_order_lines; DROP TABLE IF EXISTS webhook_events; DROP TABLE IF EXISTS payment_attempts;
      ALTER TABLE payments DROP COLUMN IF EXISTS version, DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS created_at,
        DROP COLUMN IF EXISTS method_last4, DROP COLUMN IF EXISTS method_brand, DROP COLUMN IF EXISTS failure_reason,
        DROP COLUMN IF EXISTS expires_at, DROP COLUMN IF EXISTS client_secret, DROP COLUMN IF EXISTS order_no,
        DROP COLUMN IF EXISTS buyer_id, DROP COLUMN IF EXISTS provider_intent_id, DROP COLUMN IF EXISTS provider;`);
  }
}
