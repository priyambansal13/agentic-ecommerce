import type { MigrationInterface, QueryRunner } from 'typeorm';

/** catalog service: products (own database ac_catalog only). */
export class DashboardInit1761200000000 implements MigrationInterface {
  name = 'DashboardInit1761200000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE products (
        id uuid PRIMARY KEY,
        seller_id uuid NOT NULL,
        sku text NOT NULL,
        title text NOT NULL,
        category text NOT NULL,
        price_minor bigint NOT NULL CHECK (price_minor >= 0),
        currency char(3) NOT NULL,
        status text NOT NULL CHECK (status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','REJECTED','DELISTED')),
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX products_seller ON products (seller_id);
      CREATE INDEX products_status ON products (status);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS products;`);
  }
}
