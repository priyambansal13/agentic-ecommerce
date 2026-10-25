import type { MigrationInterface, QueryRunner } from 'typeorm';

const ORDER_STATUSES = ['CREATED', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PAYMENT_FAILED', 'REJECTED', 'RETURN_IN_PROGRESS', 'REFUNDED'];
const list = (v: string[]) => v.map((s) => `'${s}'`).join(',');

/**
 * order: carts, checkout saga state, lifecycle history. Expand-only: new nullable columns + tables; the status CHECK
 * constraints are WIDENED (drop + recreate with a superset), never narrowed, so old code keeps working.
 */
export class Checkout1761600000000 implements MigrationInterface {
  name = 'Checkout1761600000000';

  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
      ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (${list(ORDER_STATUSES)}));
      ALTER TABLE seller_orders DROP CONSTRAINT IF EXISTS seller_orders_status_check;
      ALTER TABLE seller_orders ADD CONSTRAINT seller_orders_status_check CHECK (status IN (${list(ORDER_STATUSES)}));
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS subtotal_minor bigint,
        ADD COLUMN IF NOT EXISTS shipping_minor bigint,
        ADD COLUMN IF NOT EXISTS shipping_address jsonb,
        ADD COLUMN IF NOT EXISTS notify_email text,
        ADD COLUMN IF NOT EXISTS risk_decision text CHECK (risk_decision IS NULL OR risk_decision IN ('ALLOW','REVIEW','BLOCK')),
        ADD COLUMN IF NOT EXISTS risk_score numeric(4,2),
        ADD COLUMN IF NOT EXISTS risk_rules jsonb,
        ADD COLUMN IF NOT EXISTS payment_id uuid,
        ADD COLUMN IF NOT EXISTS payment_provider text,
        ADD COLUMN IF NOT EXISTS payment_status text,
        ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS cancel_reason text,
        ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE seller_orders
        ADD COLUMN IF NOT EXISTS seller_name text,
        ADD COLUMN IF NOT EXISTS shipping_minor bigint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS carrier text,
        ADD COLUMN IF NOT EXISTS tracking_no text,
        ADD COLUMN IF NOT EXISTS ship_by timestamptz,
        ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
        ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
        ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS seller_orders_shipped ON seller_orders (shipped_at) WHERE status = 'SHIPPED';
      ALTER TABLE order_lines
        ADD COLUMN IF NOT EXISTS offer_id uuid,
        ADD COLUMN IF NOT EXISTS seller_order_id uuid;
      CREATE TABLE IF NOT EXISTS order_events (
        id bigserial PRIMARY KEY,
        order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
        seller_order_id uuid,
        from_status text,
        to_status text NOT NULL,
        actor text NOT NULL,
        note text,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS order_events_order ON order_events (order_id, at);
      CREATE SEQUENCE IF NOT EXISTS order_no_seq START 300000;
      CREATE TABLE IF NOT EXISTS cart_items (
        buyer_id uuid NOT NULL,
        offer_id uuid NOT NULL,
        qty int NOT NULL CHECK (qty BETWEEN 1 AND 10),
        added_price_minor bigint NOT NULL,
        added_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (buyer_id, offer_id)
      );
      CREATE TABLE IF NOT EXISTS guest_cart_items (
        session_id text NOT NULL CHECK (session_id ~ '^[0-9a-f]{32}$'),
        offer_id uuid NOT NULL,
        qty int NOT NULL CHECK (qty BETWEEN 1 AND 10),
        added_price_minor bigint NOT NULL,
        added_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
        PRIMARY KEY (session_id, offer_id)
      );
      CREATE INDEX IF NOT EXISTS guest_cart_items_expiry ON guest_cart_items (expires_at);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS guest_cart_items; DROP TABLE IF EXISTS cart_items; DROP SEQUENCE IF EXISTS order_no_seq; DROP TABLE IF EXISTS order_events;`);
  }
}
