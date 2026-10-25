import type { MigrationInterface, QueryRunner } from 'typeorm';

/** inventory: which catalog product a SKU belongs to (for product images on dashboards). Expand-only, nullable. */
export class StockProduct1761500000000 implements MigrationInterface {
  name = 'StockProduct1761500000000';

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE stock ADD COLUMN IF NOT EXISTS product_id uuid`);
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE stock DROP COLUMN IF EXISTS product_id`);
  }
}
