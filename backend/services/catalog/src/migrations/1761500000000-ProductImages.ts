import type { MigrationInterface, QueryRunner } from 'typeorm';

/** catalog service: product gallery + category banners. Image bytes live in this service's own bucket (ac-catalog). */
export class ProductImages1761500000000 implements MigrationInterface {
  name = 'ProductImages1761500000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE product_images (
        id uuid PRIMARY KEY,
        product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
        position int NOT NULL CHECK (position >= 0),
        object_prefix text NOT NULL,
        width int NOT NULL,
        height int NOT NULL,
        alt text NOT NULL,
        source text NOT NULL CHECK (source IN ('stock','seller')),
        attribution jsonb,
        uploaded_by uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX product_images_product ON product_images (product_id, position);
      CREATE TABLE category_images (
        category_id text PRIMARY KEY REFERENCES categories (id) ON DELETE CASCADE,
        image_id uuid NOT NULL UNIQUE,
        object_prefix text NOT NULL,
        width int NOT NULL,
        height int NOT NULL,
        attribution jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS category_images; DROP TABLE IF EXISTS product_images;`);
  }
}
