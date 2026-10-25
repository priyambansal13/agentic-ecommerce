---
name: saga-and-state-machine
description: "Use when implementing or changing an aggregate lifecycle (order, seller order, refund case, reservation, payment, alert) or a multi-service workflow like the checkout saga in agentic-commerce — transition tables, version checks, history rows, compensations, timeouts. Trigger on \"status\", \"lifecycle\", \"transition\", \"saga\", \"compensation\", \"cancel flow\"."
---

# State machines & sagas

Reference diagrams: order and refund case state machines in `../platform/docs/02-lld.md` §2.5 / §2.7, checkout
saga table in §2.5, flows in `../platform/docs/04-flows.md` §4.2–4.4.

## 1. Transition table (single source of truth)
```ts
// services/order/src/modules/orders/order-state.ts
export const OrderStatus = ['CREATED','PENDING_PAYMENT','PAID','CONFIRMED','PARTIALLY_SHIPPED','SHIPPED',
  'DELIVERED','RETURN_IN_PROGRESS','PARTIALLY_REFUNDED','REFUNDED','CANCELLED','PAYMENT_FAILED','REJECTED'] as const;
export type OrderStatus = (typeof OrderStatus)[number];

const allowed: Record<OrderStatus, readonly OrderStatus[]> = {
  CREATED: ['PENDING_PAYMENT', 'REJECTED'],
  PENDING_PAYMENT: ['PAID', 'PAYMENT_FAILED'],
  PAID: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PARTIALLY_SHIPPED', 'SHIPPED', 'CANCELLED'],
  PARTIALLY_SHIPPED: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['RETURN_IN_PROGRESS'],
  RETURN_IN_PROGRESS: ['PARTIALLY_REFUNDED', 'REFUNDED', 'DELIVERED'],
  PARTIALLY_REFUNDED: ['RETURN_IN_PROGRESS', 'REFUNDED'],
  REFUNDED: [], CANCELLED: [], PAYMENT_FAILED: [], REJECTED: [],
};
export const canTransition = (from: OrderStatus, to: OrderStatus) => allowed[from].includes(to);
```
Unit-test the table exhaustively (every pair: allowed ⇔ in table).

## 2. Transition function (one place, always the same steps)
```ts
async transition(tx: EntityManager, orderId: string, to: OrderStatus, actor: Actor, expectedVersion?: number) {
  const o = await tx.findOneOrFail(OrderEntity, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
  if (o.status === to) return o;                                  // idempotent re-delivery
  if (!canTransition(o.status, to)) throw new ConflictException(`ORDER_${o.status}_TO_${to}`);
  if (expectedVersion !== undefined && o.version !== expectedVersion) throw new PreconditionFailedException();
  const from = o.status; o.status = to;
  await tx.save(o);                                               // @VersionColumn bumps version
  await tx.insert(OrderEventEntity, { orderId, fromStatus: from, toStatus: to, actor: actor.toString() });
  await this.outbox.enqueue(tx, statusEvent(o, from, to));        // e.g. order.confirmed.v1
  return o;
}
```
`actor` is `user:<id>`, `system`, or `agent:<id> (on behalf of user:<id>)` — required for audit.

## 3. Saga (orchestrated by the owning service)
For each step define: action, compensation, timeout, idempotency key.
| Step | Call | Idempotency key | Compensation |
|---|---|---|---|
| reserve | `POST inventory /v1/reservations` | `orderId` | `release(orderId)` |
| intent | `POST payment /internal/payments` | `orderId` | cancel intent |
- Persist saga progress on the aggregate (status + step fields) so a crash mid-saga can resume.
- Sync calls: timeout ≤ 2 s, retry only idempotent calls with jitter, circuit breaker (`opossum`).
- Async completion via events (`payment.succeeded.v1`), never polling the client.
- Timeouts as BullMQ delayed jobs (reservation expiry 15 min) that trigger compensation.
- Late events after compensation (payment succeeds after expiry) must have an explicit handler
  (auto-refund) — write a test for it.

## 4. Agents and state machines
Agents never set status directly. They call the domain API (e.g. `POST /internal/refund-cases/{id}/proposal`)
which runs the same transition function. Refund case states: `REQUESTED → GATHERING_EVIDENCE →
PROPOSED → AUTO_APPROVED|PENDING_HUMAN → … → REFUNDED` (LLD §2.7).

## 5. Docs
Change a lifecycle ⇒ update the `stateDiagram-v2` in `../platform/docs/02-lld.md` and the relevant sequence in
`../platform/docs/04-flows.md` in the same PR.

## Checklist
- [ ] Transition table + exhaustive unit test
- [ ] Single `transition()` with lock/version, history row, outbox event, actor
- [ ] Idempotent on redelivery (same target state → no-op)
- [ ] Each saga step has idempotency key, timeout, compensation
- [ ] Late/out-of-order events handled and tested
- [ ] Diagrams updated
