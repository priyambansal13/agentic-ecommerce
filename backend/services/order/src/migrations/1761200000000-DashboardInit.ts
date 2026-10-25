import type { MigrationInterface, QueryRunner } from 'typeorm';

/** order service: orders + per-seller sub-orders (own database ac_orders only). */
export class DashboardInit1761200000000 implements MigrationInterface {
  name = 'DashboardInit1761200000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE orders (
        id uuid PRIMARY KEY,
        order_no text NOT NULL UNIQUE,
        buyer_id uuid NOT NULL,
        status text NOT NULL CHECK (status IN ('PENDING_PAYMENT','PAID','CONFIRMED','SHIPPED','DELIVERED','CANCELLED','RETURN_IN_PROGRESS','REFUNDED')),
        total_minor bigint NOT NULL CHECK (total_minor >= 0),
        currency char(3) NOT NULL,
        items int NOT NULL CHECK (items > 0),
        placed_at timestamptz NOT NULL,
        shipped_at timestamptz,
        delivered_at timestamptz
      );
      CREATE INDEX orders_buyer_placed ON orders (buyer_id, placed_at DESC);
      CREATE INDEX orders_placed ON orders (placed_at);
      CREATE TABLE seller_orders (
        id uuid PRIMARY KEY,
        order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        seller_id uuid NOT NULL,
        status text NOT NULL CHECK (status IN ('PENDING_PAYMENT','PAID','CONFIRMED','SHIPPED','DELIVERED','CANCELLED','RETURN_IN_PROGRESS','REFUNDED')),
        items int NOT NULL CHECK (items > 0),
        total_minor bigint NOT NULL CHECK (total_minor >= 0),
        placed_at timestamptz NOT NULL
      );
      CREATE INDEX seller_orders_seller_status ON seller_orders (seller_id, status, placed_at);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS seller_orders; DROP TABLE IF EXISTS orders;`);
  }
}
