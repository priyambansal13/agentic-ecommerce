import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { createProducer } from '@ac/kafka';
import type { CloudEvent } from '@ac/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';

export interface OutgoingEvent<T = unknown> {
  topic: string;
  /** `<domain>.<thing_happened>.v<N>` — must exist in @ac/contracts Events */
  type: string;
  /** Kafka key → per-aggregate ordering (orderId, skuId, productId …) */
  aggregateId: string;
  subject?: string;
  data: T;
}

export function cloudEvent<T>(source: string, e: OutgoingEvent<T>): CloudEvent<T> {
  return {
    specversion: '1.0',
    id: randomUUID(),
    source,
    type: e.type,
    subject: e.subject,
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    data: e.data,
  };
}

/**
 * Transactional outbox. Call `enqueue(tx, event)` with the SAME EntityManager/transaction that changes
 * business state — never publish to Kafka from a request handler.
 */
@Injectable()
export class OutboxService {
  async enqueue<T>(tx: EntityManager, e: OutgoingEvent<T>) {
    const evt = cloudEvent(process.env.SERVICE_NAME ?? 'unknown', e);
    await tx.query(`INSERT INTO outbox (id, aggregate_id, topic, type, payload) VALUES ($1, $2, $3, $4, $5)`, [
      evt.id,
      e.aggregateId,
      e.topic,
      e.type,
      JSON.stringify(evt),
    ]);
    return evt;
  }
}

/** Polls the outbox (FOR UPDATE SKIP LOCKED, safe with many replicas) and publishes to Kafka. */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private producer?: Awaited<ReturnType<typeof createProducer>>;
  private busy = false;

  constructor(private readonly db: DataSource) {}

  async onModuleInit() {
    if (!process.env.KAFKA_BROKERS || process.env.OUTBOX_RELAY === 'off') return this.log.warn('outbox relay disabled');
    try {
      this.producer = await createProducer(`${process.env.SERVICE_NAME}-outbox`);
    } catch (e) {
      return this.log.error(`Kafka unavailable, outbox relay not started: ${(e as Error).message}`);
    }
    this.timer = setInterval(() => void this.tick(), Number(process.env.OUTBOX_POLL_MS ?? 500));
  }

  async tick() {
    if (this.busy || !this.producer) return;
    this.busy = true;
    try {
      await this.db.transaction(async (tx) => {
        const rows: { id: string; aggregate_id: string; topic: string; payload: unknown }[] = await tx.query(
          `SELECT id, aggregate_id, topic, payload FROM outbox WHERE published_at IS NULL
           ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`,
        );
        for (const r of rows) {
          await this.producer!.send(r.topic, [{ key: r.aggregate_id, value: JSON.stringify(r.payload), headers: { 'ce-id': r.id } }]);
        }
        if (rows.length) await tx.query(`UPDATE outbox SET published_at = now() WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
      });
    } catch (e) {
      this.log.error(`outbox publish failed (will retry): ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.producer?.disconnect();
  }
}
