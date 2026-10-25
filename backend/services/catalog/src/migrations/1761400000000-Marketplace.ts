import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * catalog service (own database ac_catalog): categories (gating), Brand Registry, shared catalog products + offers
 * (many sellers per product), and a local seller-eligibility read model fed by user.events. Expand-only: the
 * legacy single-seller columns on products (seller_id, sku, price_minor) stay.
 */
export class Marketplace1761400000000 implements MigrationInterface {
  name = 'Marketplace1761400000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE categories (
        id text PRIMARY KEY,
        name text NOT NULL,
        gated boolean NOT NULL DEFAULT false,
        requirement text,
        sort int NOT NULL DEFAULT 0
      );
      CREATE TABLE seller_eligibility (
        seller_id uuid PRIMARY KEY,
        display_name text NOT NULL,
        verified boolean NOT NULL DEFAULT false,
        approved_categories text[] NOT NULL DEFAULT '{}',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE brands (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        owner_seller_id uuid NOT NULL,
        owner_name text NOT NULL,
        restricted boolean NOT NULL DEFAULT true,
        trademark_number text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX brands_name_ci ON brands (lower(name));
      CREATE TABLE brand_applications (
        id uuid PRIMARY KEY,
        seller_id uuid NOT NULL,
        seller_name text NOT NULL,
        brand_name text NOT NULL,
        trademark_number text NOT NULL,
        trademark_status text NOT NULL CHECK (trademark_status IN ('REGISTERED','PENDING')),
        relationship text NOT NULL CHECK (relationship IN ('OWNER','MANUFACTURER','AUTHORIZED_AGENT')),
        evidence_url text,
        restrict_resellers boolean NOT NULL,
        status text NOT NULL CHECK (status IN ('SUBMITTED','APPROVED','REJECTED')),
        checks jsonb NOT NULL DEFAULT '[]',
        submitted_at timestamptz NOT NULL DEFAULT now(),
        decided_at timestamptz,
        decided_by text,
        note text,
        version int NOT NULL DEFAULT 1
      );
      CREATE UNIQUE INDEX brand_applications_open_name ON brand_applications (lower(brand_name)) WHERE status = 'SUBMITTED';
      CREATE INDEX brand_applications_seller ON brand_applications (seller_id);
      CREATE TABLE brand_resellers (
        brand_id uuid NOT NULL REFERENCES brands (id) ON DELETE CASCADE,
        seller_id uuid NOT NULL,
        seller_name text NOT NULL,
        authorized_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (brand_id, seller_id)
      );
      ALTER TABLE products
        ADD COLUMN brand text NOT NULL DEFAULT 'Generic',
        ADD COLUMN description text NOT NULL DEFAULT '',
        ADD COLUMN bullets jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN mrp_minor bigint CHECK (mrp_minor IS NULL OR mrp_minor > 0),
        ADD COLUMN created_by uuid,
        ADD COLUMN moderation_note text;
      CREATE INDEX products_brand ON products (lower(brand));
      CREATE INDEX products_category_status ON products (category, status);
      CREATE TABLE offers (
        id uuid PRIMARY KEY,
        product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
        seller_id uuid NOT NULL,
        seller_sku text NOT NULL,
        price_minor bigint NOT NULL CHECK (price_minor > 0),
        mrp_minor bigint CHECK (mrp_minor IS NULL OR mrp_minor >= price_minor),
        quantity int NOT NULL CHECK (quantity >= 0),
        currency char(3) NOT NULL,
        status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE','PENDING_PRODUCT')),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (product_id, seller_id)
      );
      CREATE INDEX offers_seller ON offers (seller_id);
      CREATE INDEX offers_product_active ON offers (product_id) WHERE status = 'ACTIVE';`);
  }

  async down(q: QueryRunner) {
    await q.query(`
      DROP TABLE IF EXISTS offers; DROP TABLE IF EXISTS brand_resellers; DROP TABLE IF EXISTS brand_applications; DROP TABLE IF EXISTS brands;
      DROP TABLE IF EXISTS seller_eligibility; DROP TABLE IF EXISTS categories;
      ALTER TABLE products DROP COLUMN IF EXISTS brand, DROP COLUMN IF EXISTS description, DROP COLUMN IF EXISTS bullets,
        DROP COLUMN IF EXISTS mrp_minor, DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS moderation_note;`);
  }
}
