import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expand-only: order lines (for "Your Orders" cards and "Buy Again") + nullable ship-to columns on orders.
 * Old code keeps working (it never reads these); nothing is renamed or dropped.
 */
export class OrderLines1761300000000 implements MigrationInterface {
  name = 'OrderLines1761300000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE order_lines (
        id bigserial PRIMARY KEY,
        order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id uuid NOT NULL,
        title text NOT NULL,
        category text NOT NULL,
        seller_id uuid NOT NULL,
        seller_name text NOT NULL,
        qty int NOT NULL CHECK (qty > 0),
        unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0)
      );
      CREATE INDEX order_lines_order ON order_lines (order_id);
      ALTER TABLE orders ADD COLUMN ship_to_name text;
      ALTER TABLE orders ADD COLUMN ship_to_city text;`);
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE orders DROP COLUMN IF EXISTS ship_to_city; ALTER TABLE orders DROP COLUMN IF EXISTS ship_to_name; DROP TABLE IF EXISTS order_lines;`);
  }
}
