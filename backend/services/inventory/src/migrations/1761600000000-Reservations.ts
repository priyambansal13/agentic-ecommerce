import type { MigrationInterface, QueryRunner } from 'typeorm';

/** inventory: stock per catalog OFFER (sku_id = offer id), reservations (one per order, lines per SKU) and the
 *  stock movement log. Expand-only. */
export class Reservations1761600000000 implements MigrationInterface {
  name = 'Reservations1761600000000';

  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE stock ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      CREATE TABLE IF NOT EXISTS reservations (
        order_id uuid PRIMARY KEY,
        status text NOT NULL CHECK (status IN ('ACTIVE','COMMITTED','RELEASED','EXPIRED')),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        closed_at timestamptz,
        returned_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS reservations_active_expiry ON reservations (expires_at) WHERE status = 'ACTIVE';
      CREATE TABLE IF NOT EXISTS reservation_lines (
        order_id uuid NOT NULL REFERENCES reservations (order_id) ON DELETE CASCADE,
        sku_id uuid NOT NULL,
        qty int NOT NULL CHECK (qty > 0),
        PRIMARY KEY (order_id, sku_id)
      );
      CREATE TABLE IF NOT EXISTS stock_movements (
        id bigserial PRIMARY KEY,
        sku_id uuid NOT NULL,
        delta_on_hand int NOT NULL DEFAULT 0,
        delta_reserved int NOT NULL DEFAULT 0,
        reason text NOT NULL CHECK (reason IN ('SEED','LISTED','RESTOCK','ADJUST','RESERVE','RELEASE','EXPIRE','COMMIT','RETURN')),
        ref_id text,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS stock_movements_sku ON stock_movements (sku_id, at DESC);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS stock_movements; DROP TABLE IF EXISTS reservation_lines; DROP TABLE IF EXISTS reservations; ALTER TABLE stock DROP COLUMN IF EXISTS updated_at;`);
  }
}
