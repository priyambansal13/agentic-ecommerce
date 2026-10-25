import type { MigrationInterface, QueryRunner } from 'typeorm';

/** inventory service: stock per SKU (own database ac_inventory only). */
export class DashboardInit1761200000000 implements MigrationInterface {
  name = 'DashboardInit1761200000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE stock (
        sku_id uuid PRIMARY KEY,
        seller_id uuid NOT NULL,
        sku text NOT NULL,
        title text NOT NULL,
        on_hand int NOT NULL,
        reserved int NOT NULL DEFAULT 0,
        low_stock_threshold int NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
        version int NOT NULL DEFAULT 1,
        CONSTRAINT stock_non_negative CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand)
      );
      CREATE INDEX stock_seller ON stock (seller_id);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS stock;`);
  }
}
