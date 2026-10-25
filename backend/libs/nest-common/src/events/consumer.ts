import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { createConsumer } from '@ac/kafka';
import type { CloudEvent } from '@ac/contracts';
import { DataSource, type EntityManager } from 'typeorm';

export type EventHandler = (evt: CloudEvent, tx: EntityManager) => Promise<void>;

/**
 * Idempotent consumers: each event id is recorded in processed_events in the SAME transaction as the
 * handler's writes, so redelivery (at-least-once) has exactly-once effect.
 *
 *   constructor(events: EventConsumerService) {}
 *   onModuleInit() { return this.events.subscribe('inventory-orders', ['order.events'], this.onOrderEvent); }
 */
@Injectable()
export class EventConsumerService implements OnApplicationShutdown {
  private readonly log = new Logger(EventConsumerService.name);
  private readonly consumers: { disconnect: () => Promise<void> }[] = [];

  constructor(private readonly db: DataSource) {}

  async subscribe(consumerName: string, topics: string[], handler: EventHandler) {
    if (!process.env.KAFKA_BROKERS) return this.log.warn(`KAFKA_BROKERS unset — ${consumerName} not started`);
    const groupId = `${process.env.SERVICE_NAME}.${consumerName}`;
    const c = await createConsumer(groupId, groupId, topics, async (msg) => {
      if (!msg.value) return;
      const evt = JSON.parse(msg.value) as CloudEvent;
      await this.db.transaction(async (tx) => {
        const fresh = await tx.query(
          `INSERT INTO processed_events (event_id, consumer) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id`,
          [evt.id, consumerName],
        );
        if (!fresh.length) return; // duplicate delivery
        await handler(evt, tx);
      });
    });
    this.consumers.push(c);
    this.log.log(`${consumerName} consuming ${topics.join(', ')}`);
  }

  async onApplicationShutdown() {
    await Promise.all(this.consumers.map((c) => c.disconnect()));
  }
}
