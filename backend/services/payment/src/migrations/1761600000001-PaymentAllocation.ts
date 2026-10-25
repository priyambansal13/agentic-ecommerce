import type { MigrationInterface, QueryRunner } from 'typeorm';

/** payment service: allocation + cancellation markers for captures (own database ac_payments only). */
export class PaymentAllocation1761600000001 implements MigrationInterface {
  name = 'PaymentAllocation1761600000001';

  async up(q: QueryRunner) {
    await q.query(`
      -- capture posted before order.created.v1 arrived → credited to suspense, allocated to sellers later
      ALTER TABLE payments ADD COLUMN allocated_at timestamptz;
      -- order.cancelled.v1 seen: a success arriving afterwards (e.g. PROCESSING at expiry) is refunded automatically
      ALTER TABLE payments ADD COLUMN order_cancelled_at timestamptz;
      -- seeded/demo captures are fully allocated already
      UPDATE payments SET allocated_at = captured_at WHERE status = 'SUCCEEDED' AND provider IS NULL;`);
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE payments DROP COLUMN IF EXISTS order_cancelled_at; ALTER TABLE payments DROP COLUMN IF EXISTS allocated_at;`);
  }
}
