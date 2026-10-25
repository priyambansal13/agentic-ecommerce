---
name: service-resilience
description: "Use when a microservice calls another service or external dependency (HTTP via Kong, Stripe/Razorpay, OpenAI, OpenSearch, Kafka) or when hardening a service for production — timeouts, retries with jitter only for idempotent calls, circuit breakers (opossum), bulkheads, health/readiness, graceful shutdown and degraded modes. Trigger on \"call service X\", \"flaky dependency\", \"timeout\", \"retry\", \"circuit breaker\", \"make it resilient\"."
---

# Resilient service-to-service communication

Microservices fail independently — design every remote call to fail fast, degrade, and recover.
Targets come from `../platform/docs/01-hld.md` §1.8 (NFR mapping) and `05-roadmap.md` §5.5 (SLOs).

## 1. Prefer async; keep sync calls few
- Can the caller react to an event instead (Kafka, `domain-event` skill)? Prefer that.
- Need data from another service on every request? Keep a **local read model** fed by its events
  rather than a synchronous call chain. Max sync depth: gateway → service → one downstream.

## 2. A typed client per dependency
```ts
// services/order/src/clients/inventory.client.ts
import CircuitBreaker from 'opossum';

const BASE = process.env.INVENTORY_URL ?? 'http://localhost:58000/api/inventory';   // via Kong / service DNS

export class InventoryClient {
  private readonly reserveBreaker = new CircuitBreaker(this.doReserve.bind(this), {
    timeout: 2_000,                 // per attempt
    errorThresholdPercentage: 50,   // open after 50% failures …
    volumeThreshold: 10,            // … over at least 10 calls
    resetTimeout: 10_000,           // half-open probe after 10 s
    capacity: 20,                   // bulkhead: max concurrent calls
  });

  constructor(private readonly token: () => Promise<string>) {
    this.reserveBreaker.fallback(() => { throw new ServiceUnavailableException('inventory unavailable'); });
  }

  reserve(orderId: string, lines: Line[]) {
    return this.reserveBreaker.fire(orderId, lines);
  }

  private async doReserve(orderId: string, lines: Line[]) {
    const r = await fetch(`${BASE}/v1/reservations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json',
                 'idempotency-key': `reserve:${orderId}`, 'x-request-id': currentRequestId() },
      body: JSON.stringify({ orderId, lines, ttlSec: 900 }),
      signal: AbortSignal.timeout(2_000),
    });
    if (r.status === 409) return { ok: false as const, conflict: await r.json() };   // business outcome, not a failure
    if (!r.ok) throw new Error(`inventory ${r.status}`);
    return { ok: true as const, reservation: ReservationSchema.parse(await r.json()) };   // validate with @ac/contracts
  }
}
```
Service-to-service auth: client-credentials token from Keycloak (`services` client), cached until expiry.

## 3. Retries — only when safe
| Call | Retry? |
|---|---|
| GET / idempotent read | yes: 2 retries, exponential backoff + full jitter (100 ms → 400 ms) |
| POST with `Idempotency-Key` | yes, same key each attempt |
| POST without idempotency (payment capture, refund) | **never** blindly — make it idempotent first |
| 4xx (except 408/429) | no |
| 429 | honour `Retry-After` |
Retries live **inside** the breaker; total time budget ≤ caller's own timeout.

## 4. Timeouts budget
Kong upstream 30 s (agents 300 s) > service handler budget > downstream timeout (2 s typical, OpenAI
60 s only inside agents). Always pass `AbortSignal`. DB: `statement_timeout` per role (e.g. 5 s).

## 5. Degraded modes (decide per call)
| Dependency down | Behaviour |
|---|---|
| OpenSearch | search falls back to category browse from catalog read model |
| Fraud scoring | checkout proceeds with `REVIEW` decision (docs/02 §2.5) |
| OpenAI | agents return a "classic form" fallback; event-driven agents retry from Kafka |
| Kafka | outbox keeps rows; relay retries — no request fails |
| Payment gateway | checkout returns 503 with retry hint; no partial order state |

## 6. Health, readiness, shutdown
- `/health` (liveness) must not call downstream services; DB ping only.
- Readiness = DB + required consumers connected; the Kubernetes readiness/liveness probes use it.
- `enableShutdownHooks()` is on (bootstrapService): stop accepting, finish in-flight, disconnect Kafka,
  close pool. Keep handlers < 30 s so rolling updates drain cleanly (pod `terminationGracePeriodSeconds`).
- Remember the network rule in the cluster: a service is reachable **only from `edge`** (NetworkPolicy) —
  call other services through `KONG_URL`, never `http://<service>:<port>` directly.
- Single shared node (12 GB): set sane memory limits; a leak in one service must OOM only that pod.

## 7. Observability
Propagate `x-request-id` / `traceparent` on every call (OTel auto-instrumentation does HTTP, pg, Kafka).
Emit breaker metrics (open/half-open/close events) and log fallbacks at WARN with the dependency name.

## 8. Test it
- Unit: client maps 409/5xx/timeout correctly; breaker opens after threshold (fake timers).
- Integration: stop the dependency (Testcontainers / `docker pause`) and assert the degraded mode.
- Chaos in P5: kill Kafka/OpenSearch/OpenAI locally with `ac infra` and run `ac k6 smoke.js`.

## Checklist
- [ ] Async/event alternative considered; sync depth ≤ 1 downstream
- [ ] Typed client validates responses with `@ac/contracts`
- [ ] Timeout on every call; breaker + bulkhead around it
- [ ] Retries only for idempotent calls (Idempotency-Key reused), jittered, inside budget
- [ ] Degraded mode defined and tested; liveness doesn't depend on other services
- [ ] Request id / trace propagated; breaker metrics emitted
