import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * notification service (own database ac_notify): an idempotent notification log (one row per event × channel)
 * that doubles as the email outbox, plus order contacts learnt from order events (email for later events).
 */
export class Notifications1761600000000 implements MigrationInterface {
  name = 'Notifications1761600000000';

  async up(q: QueryRunner) {
    await q.query(`
      CREATE TABLE notifications (
        id uuid PRIMARY KEY,
        event_id text NOT NULL,
        channel text NOT NULL CHECK (channel IN ('email','in_app')),
        user_id uuid NOT NULL,
        order_id uuid,
        kind text NOT NULL,
        to_address text,
        subject text NOT NULL,
        body_text text NOT NULL,
        body_html text,
        status text NOT NULL CHECK (status IN ('PENDING','SENT','FAILED','READ','UNREAD')),
        attempts int NOT NULL DEFAULT 0,
        last_error text,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        sent_at timestamptz,
        UNIQUE (event_id, channel)
      );
      CREATE INDEX notifications_pending ON notifications (next_attempt_at) WHERE status = 'PENDING';
      CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);
      CREATE TABLE order_contacts (
        order_id uuid PRIMARY KEY,
        user_id uuid NOT NULL,
        order_no text NOT NULL,
        email text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS order_contacts; DROP TABLE IF EXISTS notifications;`);
  }
}
