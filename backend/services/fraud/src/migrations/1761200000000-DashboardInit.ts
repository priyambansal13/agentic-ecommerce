import type { MigrationInterface, QueryRunner } from 'typeorm';

/** fraud service: risk alerts raised by the rules engine (own database ac_fraud only). */
export class DashboardInit1761200000000 implements MigrationInterface {
  name = 'DashboardInit1761200000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE alerts (
        id uuid PRIMARY KEY,
        subject_type text NOT NULL CHECK (subject_type IN ('ORDER','REFUND','SIGNUP','PAYOUT')),
        subject text NOT NULL,
        score numeric(4,2) NOT NULL CHECK (score BETWEEN 0 AND 1),
        decision text NOT NULL CHECK (decision IN ('ALLOW','REVIEW','BLOCK')),
        status text NOT NULL CHECK (status IN ('OPEN','INVESTIGATING','CONFIRMED_FRAUD','FALSE_POSITIVE')),
        rules jsonb NOT NULL DEFAULT '[]',
        raised_at timestamptz NOT NULL
      );
      CREATE INDEX alerts_status_raised ON alerts (status, raised_at DESC);`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS alerts;`);
  }
}
