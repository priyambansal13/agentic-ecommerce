---
name: domain-event
description: "Use when a service must publish or consume a domain event (Kafka) in agentic-commerce — CloudEvents schema in @ac/contracts, transactional outbox write, topic registration, idempotent consumer with processed_events, and contract tests. Trigger on \"publish event\", \"consume X event\", \"react when order is paid\", \"emit ...Created\"."
---

# Publish / consume a domain event

Pattern (see `../platform/docs/01-hld.md` §1.4 and `../platform/docs/02-lld.md` "Shared mechanisms"):
`business write + outbox row (same tx) → outbox relay → Kafka → consumer (dedupe on event id in same tx as its effect)`.

## 1. Name & version
- Type: `<domain>.<thing>_<past_tense>.v<N>` e.g. `order.created.v1`, `payment.refund_succeeded.v1`.
- Topic: `<domain>.events` (one topic per domain), key = aggregate id (orderId, skuId, productId) for
  per-aggregate ordering.
- Breaking payload change → new version `v2`; publish both during migration.

## 2. Schema (libs/contracts)
```ts
// libs/contracts/src/order/events.ts
import { z } from 'zod';
import { cloudEvent } from '../common/cloudevent.js';
import { MoneySchema } from '../common/money.js';

export const OrderCreatedV1 = cloudEvent('order.created.v1', z.object({
  orderId: z.uuid(),
  buyerId: z.uuid(),
  total: MoneySchema,
  lines: z.array(z.object({ skuId: z.uuid(), sellerId: z.uuid(), qty: z.int().positive() })),
}));
export type OrderCreatedV1 = z.infer<typeof OrderCreatedV1>;
```
`cloudEvent()` wraps the envelope: `specversion, id (ULID), source, type, subject, time, traceparent, data`.
Minimise PII in payloads (ids, not addresses/emails); consumers fetch details via API if authorised.

## 3. Publish via outbox (never `producer.send` in a request path)
```ts
await this.dataSource.transaction(async (tx) => {
  const order = await tx.getRepository(OrderEntity).save(entity);
  await this.outbox.enqueue(tx, {          // OutboxService from @ac/nest-common
    topic: TOPICS.order,                   // TOPICS from @ac/contracts
    type: 'order.created.v1',              // must exist in @ac/contracts Events
    aggregateId: order.id,                 // Kafka key → per-order ordering
    subject: `order/${order.id}`,
    data: { orderId: order.id, buyerId: order.buyerId, total, lines },
  });                                      // builds the CloudEvent (id, source, time) for you
});
```
The relay (`@ac/nest-common` outbox module) polls `WHERE published_at IS NULL ... FOR UPDATE SKIP LOCKED`,
sends with key = aggregateId, marks `published_at`. Delivery is at-least-once.

## 4. Register the topic
- `../platform/infra/kafka/topics.json` (partitions 6 local, replication 1) — `node ../platform/scripts/ac.mjs infra init` creates it.
- `TOPICS` constant in `libs/contracts/src/index.ts`.

## 5. Consume idempotently
```ts
// EventConsumerService (from @ac/nest-common) records processed_events(event_id, consumer) in the SAME
// transaction as your handler — duplicates are skipped automatically.
@Injectable()
export class PaymentEventsConsumer implements OnModuleInit {
  constructor(private readonly events: EventConsumerService, private readonly reservations: ReservationsService) {}

  onModuleInit() {
    return this.events.subscribe('inventory-payments', [TOPICS.payment], async (raw, tx) => {
      if (raw.type !== 'payment.succeeded.v1') return;
      const evt = parseEvent('payment.succeeded.v1', raw);   // reject unknown shapes → DLQ
      await this.reservations.commit(tx, evt.data.orderId);
    });
  }
}
```
- Effects + dedupe row in one transaction ⇒ exactly-once *effect*.
- Out-of-order safety: use aggregate `version`, or check current state before transitioning.
- Poison messages: after N retries → `<topic>.dlq` with error; alert.
- Agent triggers (moderation, fraud triage, refund) consume the same way inside `services/agents/src/runtime/triggers/`.

## 6. Tests
- Contract: fixture JSON in `libs/contracts/test/fixtures/<type>.json` parses with the schema;
  CI fails on incompatible change.
- Integration (Testcontainers Postgres + Redpanda): write → relay → consume; send same event twice
  → single effect.

## 7. Docs
Update the Publishes/Consumes columns in `../platform/docs/01-hld.md` §1.2 and the sequence in `../platform/docs/04-flows.md`
if a flow changes.

## Microservice rules
- Event schemas are the public API between services: additive changes only within a version
  (`order.created.v1` + optional fields); breaking → publish `v2` alongside `v1` until consumers migrate.
- Each consumer uses its **own** consumer group (`<service>.<consumerName>`) and writes only to its own
  database (local read model). Never call back synchronously to the producer inside a handler if the
  event already carries what you need.
- Contract changes → `pnpm changeset` + `contracts-release` (platform repo) so other repos get the version.

## Checklist
- [ ] Versioned type name, topic per domain, key = aggregate id
- [ ] zod CloudEvents schema in contracts, no unnecessary PII
- [ ] Outbox write in the same transaction as the state change
- [ ] Topic in `topics.json` + `@ac/kafka`
- [ ] Consumer parses, dedupes via `processed_events` in-tx, handles out-of-order, DLQ
- [ ] Contract + duplicate-delivery tests
- [ ] HLD table / flow diagram updated
- [ ] Additive change or new event version; changeset added
- [ ] Own consumer group; writes only to own database
