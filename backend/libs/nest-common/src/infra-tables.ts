import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Platform tables every service with a database gets (in its own database): outbox, processed_events,
 * idempotency_keys. Business tables are created by TypeORM migrations, not here.
 */
@Injectable()
export class InfraTables implements OnModuleInit {
  constructor(private readonly db: DataSource) {}
  async onModuleInit() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS outbox (
        id uuid PRIMARY KEY, aggregate_id text NOT NULL, topic text NOT NULL, type text NOT NULL,
        payload jsonb NOT NULL, headers jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz);
      CREATE INDEX IF NOT EXISTS outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;
      CREATE TABLE IF NOT EXISTS processed_events (
        event_id text NOT NULL, consumer text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (event_id, consumer));
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key text NOT NULL, principal_id text NOT NULL, request_hash text NOT NULL, status text NOT NULL,
        response_code int, response_body jsonb, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (principal_id, key));`);
  }
}
