# 4. Flow Diagrams

All UI traffic enters through the **shell zone**, which rewrites to the owning zone; zones call the
backend only through their BFF route handlers → Kong → the owning microservice (see 4.11). Participants
named "zone" below include that path.

## 4.1 Browse & search (hot path, < 300 ms)

```mermaid
sequenceDiagram
  autonumber
  actor B as Buyer
  participant CDN as CDN
  participant N as storefront zone (RSC, via shell)
  participant K as Kong
  participant S as Search Svc
  participant R as Redis
  participant O as OpenSearch
  participant L as OpenAI (fast)

  B->>CDN: GET /s?q=waterproof running shoes under 3000
  CDN->>N: cache miss (dynamic)
  N->>K: GET /v1/search?q=...
  K->>S: forward (rate limited)
  S->>R: GET qcache:{normalized q}
  alt cached
    R-->>S: results
  else not cached
    opt query has 4+ words
      S->>L: parse query to filters (timeout 400 ms)
      L-->>S: text + price_lte + gender
    end
    S->>O: hybrid query (BM25 + kNN) with filters
    O-->>S: hits + facets
    S->>R: SET qcache TTL 60s
  end
  S-->>N: results
  N-->>B: streamed HTML (PPR shell + results)
```

## 4.2 Checkout saga + payment (strong inventory consistency)

```mermaid
sequenceDiagram
  autonumber
  actor B as Buyer
  participant N as storefront zone (Server Action / BFF)
  participant OS as Order Svc
  participant FR as Fraud Svc
  participant IS as Inventory Svc
  participant PS as Payment Svc
  participant ST as Gateway (testpay | Stripe)
  participant KF as Kafka

  B->>N: Place order
  N->>OS: POST /v1/checkout (Idempotency-Key)
  OS->>OS: load cart, re-price, create ORDER(CREATED)
  OS->>FR: POST /internal/risk/score (300 ms)
  FR-->>OS: ALLOW / REVIEW / BLOCK
  alt BLOCK
    OS-->>N: 422 order rejected
  else ALLOW or REVIEW
    OS->>IS: POST /internal/reservations (orderId, lines, ttl 15m)
    alt insufficient stock
      IS-->>OS: 409 (skus)
      OS-->>N: 409 show out-of-stock lines
    else reserved
      IS-->>OS: 201 reservation (ACTIVE, expiresAt)
      OS->>PS: POST /internal/payments (orderId, amount)
      PS->>ST: create session (testpay intent | Stripe PaymentIntent, idempotency = orderId)
      ST-->>PS: intent id (+ clientSecret for Stripe)
      PS-->>OS: payment session
      OS->>OS: status PENDING_PAYMENT, cart cleared (order.created.v1 was written with ORDER(CREATED))
      OS-->>N: orderId, clientSecret
      N-->>B: pay page — testpay test card form, or Stripe Payment Element (3DS if needed)
    end
  end
  ST->>PS: signed webhook (testpay payment.succeeded | Stripe payment_intent.succeeded)
  PS->>PS: verify HMAC over raw body, dedupe on event id, ledger CAPTURE + FEE, outbox PaymentSucceeded
  PS-->>ST: 200
  PS-)KF: payment.succeeded.v1
  KF-)IS: commit reservation (on_hand -= qty)
  KF-)OS: PAID then CONFIRMED (if risk ALLOW), outbox OrderConfirmed
  KF-)KF: order.confirmed.v1 to Notification + Seller Analytics
```

Payment notes (as built, [ADR 0014](adr/0014-testpay-and-webhook-truth.md)): **testpay** is a built-in TEST gateway
(no real money) that delivers signed webhooks ~1 s after a card is submitted — sometimes twice, to prove dedupe —
so the webhook-truth path runs locally and in demos; **Stripe** test mode switches on when its keys are set. A
declined card ends the session (`payment.failed.v1`). A capture that arrives before `order.created.v1` is parked in
`suspense:unallocated` and allocated when the order lines arrive. `order.cancelled.v1` refunds a paid order in full and
reverses its marketplace fees (`payment.refunded.v1`); emails go out from the notification service (Mailpit locally).

Order/inventory notes (as built): all service-to-service calls go through Kong with a client-credentials token of the
customers-realm `services` client (realm role `service`; `ServiceClient` in `@ac/nest-common` — token cache, timeouts,
retries only for GET/idempotent calls, a circuit breaker per target). Internal endpoints are `/v1/internal/…`. The order
row is written **before** the risk/stock/payment steps so rejected attempts stay auditable (`REJECTED`, hidden from
"Your Orders"); a failed step after the reservation releases it (idempotent). Stock is reserved per **offer** (SKU =
offer id) with one conditional `UPDATE … WHERE on_hand - reserved >= qty` per line in one transaction — the k6
`flash-sale.js` test (1,000 concurrent buyers, 100 units) gets exactly 100 reservations and 900 clean 409s. REVIEW
orders are confirmed but keep `risk_decision = REVIEW` for the fraud analyst (an analyst hold is future work).
Guest carts live in the order database (`guest_cart_items`, 7-day sliding TTL) rather than Redis.

### 4.2.1 Failure / expiry path

```mermaid
sequenceDiagram
  autonumber
  participant J as Expiry sweeper (inventory, every 30 s)
  participant IS as Inventory Svc
  participant KF as Kafka
  participant OS as Order Svc
  participant PS as Payment Svc

  J->>IS: find ACTIVE reservations past expires_at (FOR UPDATE SKIP LOCKED)
  IS->>IS: reserved -= qty, status EXPIRED, outbox inventory.reservation_released.v1 (EXPIRED)
  IS-)KF: inventory.reservation_released.v1
  KF-)OS: PENDING_PAYMENT → CANCELLED (PAYMENT_EXPIRED), lines back into the cart, outbox order.cancelled.v1
  KF-)PS: order.cancelled.v1 → cancel the payment session
  Note over OS,PS: A declined card: payment.failed.v1 → order PAYMENT_FAILED, inventory releases, cart restored.<br/>A late payment.succeeded after the order closed → order.cancelled.v1 with refundRequired → Payment refunds.
```

## 4.3 Governed refund — happy path with auto-approval (AG-UI)

> **As built (P3, 2026-10-24):** while the refund agent runs at **L1 shadow**, every return first takes the
> deterministic path in the returns service (policy → hard reject or `PENDING_HUMAN`); the agent's proposals are stored
> as SHADOW and compared with the human decision (shadow report). The auto-approval below applies once the agent is
> switched to LIVE (L3): the returns service re-evaluates the policy and only auto-approves inside the R3 envelope on a
> case no human has touched. See [02 §2.7 as built](02-lld.md#as-built-p3-2026-10-24).

```mermaid
sequenceDiagram
  autonumber
  actor B as Buyer
  participant UI as account zone refund widget + BFF
  participant AG as agents service (via Kong)
  participant G as Refund graph (LangGraph)
  participant RS as Returns Svc
  participant OS as Order Svc
  participant FR as Fraud Svc
  participant OPA as OPA
  participant PS as Payment Svc
  participant LLM as OpenAI

  B->>UI: "Headphones arrived with a cracked case"
  UI->>AG: POST /v1/agents/refund/run (RunAgentInput, user session)
  AG->>AG: token exchange (act=agent:refund), budget check
  AG->>RS: create case (POST /v1/returns)
  AG->>G: start thread caseId
  G-->>UI: RUN_STARTED, STEP_STARTED intake
  G->>LLM: classify reason + match order line (structured)
  G->>OS: getOrder, getTracking
  G->>RS: getBuyerRefundHistory
  G-->>UI: TEXT_MESSAGE "Sorry about that. Could you upload a photo of the damage?"
  G->>G: interrupt(request_photo), checkpoint saved
  G-->>UI: RUN_FINISHED outcome interrupt (reason upload_photo)
  B->>UI: uploads photo (presigned S3)
  UI->>AG: new run with resume [interruptId, payload evidenceId]
  AG->>G: Command(resume)
  G->>LLM: vision check (damage? matches SKU?)
  G->>FR: scoreRisk(REFUND) = 0.12
  G->>RS: evaluatePolicy = allowed REFUND / REPLACEMENT, auto envelope up to 2000 INR
  G->>LLM: propose (outcome, amount 1299, rationale, confidence 0.91)
  G->>RS: submitProposal, case AUTO_APPROVED
  G-->>UI: RUN_FINISHED outcome interrupt (reason offer, options refund 1299 / replacement)
  B->>UI: chooses "Refund"
  UI->>AG: resume(choice=refund)
  AG->>G: Command(resume)
  G->>OPA: authorize executeRefund(case, 1299)
  OPA-->>G: allow
  G->>RS: POST /internal/refund-cases/{id}/execute (Idempotency-Key runId:toolCallId)
  RS->>PS: POST /internal/refunds (refundCaseId)
  PS-->>RS: PENDING
  G-->>UI: STATE_DELTA case.status = REFUND_PENDING, TEXT_MESSAGE "Refund initiated..."
  G-->>UI: RUN_FINISHED
  Note over PS,RS: Stripe webhook refund.succeeded leads to RefundSucceeded, case REFUNDED, buyer + seller notified
```

## 4.4 Governed refund — escalation to human (HITL)

```mermaid
sequenceDiagram
  autonumber
  participant G as Refund graph
  participant RS as Returns Svc
  participant AG as agents service (via Kong)
  participant KF as Kafka
  participant Q as admin zone approval queue
  actor SA as Support agent
  actor FIN as Finance approver
  actor B as Buyer

  G->>RS: proposal outside envelope (amount 32000 INR, risk 0.41)
  RS-->>G: case PENDING_HUMAN
  G->>G: interrupt(human_review), checkpoint
  G->>AG: create approvals row (required_role=support)
  AG-)KF: agent.escalated.v1
  G-->>B: "A specialist will review within 24h" (if chat open, else email)
  KF-)Q: new item in queue
  SA->>Q: opens case: evidence, rule hits, similar cases, agent rationale
  SA->>Q: approve, edits amount to 30000
  Q->>AG: resume(decision)
  AG->>G: Command(resume)
  G->>G: amount above dual-control threshold, interrupt(finance_review)
  FIN->>Q: approve
  Q->>AG: resume(decision)
  G->>RS: execute (OPA allows: human approvals present)
  RS-->>G: REFUND_PENDING
  G-)B: notification "Refund of 30000 INR approved"
```

## 4.5 Shopping assistant with generative UI + frontend tool confirmation

```mermaid
sequenceDiagram
  autonumber
  actor B as Buyer
  participant UI as storefront zone assistant widget + BFF
  participant AG as agents service (via Kong)
  participant G as Assistant graph
  participant S as Search Svc
  participant OS as Order Svc (cart)
  participant LLM as OpenAI

  B->>UI: "noise cancelling headphones for flights under 10k"
  UI->>AG: run (tools: [confirmAddToCart] as frontend tool)
  AG->>G: start
  G->>LLM: route + parse filters
  G-->>UI: TOOL_CALL_START searchProducts
  G->>S: search (hybrid, price_lte 1000000)
  S-->>G: 20 hits
  G-->>UI: TOOL_CALL_RESULT (hits)
  UI->>UI: render ProductCard carousel from tool result
  G->>LLM: rerank + short explanation grounded in hits
  G-->>UI: TEXT_MESSAGE_CONTENT (streamed)
  B->>UI: "add the second one"
  UI->>AG: run (message)
  G-->>UI: TOOL_CALL confirmAddToCart(skuId, qty 1)
  UI->>B: confirm dialog with price from catalog data
  B->>UI: Confirm
  UI->>AG: tool result {confirmed: true}
  G->>OS: addToCart (user token)
  G-->>UI: TEXT_MESSAGE "Added. Cart total ..."
```

## 4.6 Seller listing copilot (shared state)

```mermaid
sequenceDiagram
  autonumber
  actor SE as Seller
  participant UI as seller zone listing form + copilot
  participant G as Listing graph
  participant CS as Catalog Svc
  participant LLM as OpenAI (vision + smart)

  SE->>UI: upload 4 photos + "steel bottle 1L, keeps cold 24h"
  UI->>G: run (state: empty draft)
  G->>LLM: vision extract attributes
  G->>CS: getCategoryTree + attribute schema
  G->>LLM: map category + fill attributes (schema-constrained)
  G->>G: compliance_check (claims, restricted words)
  G-->>UI: STATE_SNAPSHOT draft (title, bullets, attributes, warnings)
  SE->>UI: edits capacity to 1.2L, asks "make title shorter"
  UI->>G: run (state with seller edits)
  G-->>UI: STATE_DELTA [replace /title]
  G->>CS: saveListingDraft (WRITE_REVERSIBLE)
  SE->>UI: Submit for review
  UI->>CS: POST /v1/products/{id}/submit (seller action, not agent)
```

## 4.7 Event-driven moderation

```mermaid
sequenceDiagram
  autonumber
  participant CS as Catalog Svc
  participant KF as Kafka
  participant MA as Moderation agent (consumer)
  participant LLM as OpenAI
  participant AD as Admin Svc
  actor MOD as Moderator

  CS-)KF: catalog.product_submitted.v1
  KF-)MA: consume (idempotent on productId+version)
  MA->>LLM: omni-moderation (text + images)
  MA->>LLM: policy classifier (structured verdict)
  MA->>MA: duplicate image hash, price-band anomaly
  alt all pass, high confidence, seller not NEW, category low-risk
    MA->>AD: verdict APPROVE (autonomy L4)
    AD-)KF: admin.moderation_decided.v1 (approved, actor agent:moderation)
    Note over AD: 5% sampled into QA queue
  else otherwise
    MA->>AD: verdict NEEDS_REVIEW / REJECT suggestion with reasons and spans
    MOD->>AD: decide
    AD-)KF: admin.moderation_decided.v1 (actor user:mod)
  end
  KF-)CS: PUBLISHED or REJECTED
  KF-)CS: (then) Search indexes, Next.js revalidateTag
```

## 4.8 Fraud alert → investigation agent → analyst

```mermaid
sequenceDiagram
  autonumber
  participant FR as Fraud Svc (rules)
  participant KF as Kafka
  participant FA as Fraud investigator graph
  participant OS as Order Svc
  participant RS as Returns Svc
  participant UI as admin zone fraud console
  actor AN as Analyst

  FR-)KF: fraud.alert_raised.v1 (order X, rules velocity + bin_mismatch)
  KF-)FA: start run
  FA->>FR: getLinkedEntities (device, card fp, address hash)
  FA->>OS: getOrders(linked accounts)
  FA->>RS: getRefundHistory(linked accounts)
  FA->>FA: build timeline + pattern hypothesis (smart model, structured)
  FA->>FR: attach agent_summary to alert (recommend: hold + verify)
  AN->>UI: open alert, sees brief + live steps
  AN->>FR: decide CONFIRMED_FRAUD (blocklist, cancel order) or FALSE_POSITIVE
  FR-)KF: fraud.decision.v1, label stored for future ML
```

## 4.9 Dispute resolution

```mermaid
sequenceDiagram
  autonumber
  actor B as Buyer
  actor SE as Seller
  participant AD as Admin Svc (disputes)
  participant DA as Dispute graph
  participant VEC as pgvector (precedents + policy)
  actor ADM as Admin

  B->>AD: appeal rejected refund
  AD->>SE: request seller response (48h)
  SE->>AD: response + evidence
  AD-)DA: dispute.ready_for_review.v1
  DA->>VEC: policy clauses + similar resolved disputes
  DA->>DA: neutral case file, both positions, clause citations, proposed resolution
  DA->>AD: attach recommendation (L2)
  ADM->>AD: decide (accept / modify / reject)
  AD-)AD: DisputeResolved, refund executed via Returns Svc if granted, precedent embedded
```

## 4.10 Seller payout

```mermaid
sequenceDiagram
  autonumber
  participant J as Weekly payout job
  participant PS as Payment Svc (ledger)
  participant ST as Stripe Connect / Razorpay Route
  participant KF as Kafka
  participant SA as Seller Analytics

  J->>PS: compute payable per seller (delivered > 7d, minus refunds, commission, fees)
  PS->>PS: ledger PAYOUT tx (seller payable to gateway clearing)
  PS->>ST: transfer (idempotency = payoutId)
  ST-->>PS: transfer id
  ST->>PS: webhook transfer.paid
  PS-)KF: payment.payout_paid.v1
  KF-)SA: update payout summary for dashboard
```

## 4.11 Micro-frontend request flow (page + data)

```mermaid
sequenceDiagram
  autonumber
  actor B as Buyer
  participant CDN as Traefik ingress (k3s)
  participant SH as shell zone :3300
  participant ST as storefront zone :3301 (basePath /shop)
  participant K as Kong
  participant CS as catalog service
  participant DB as ac_catalog

  B->>CDN: GET /shop/p/steel-bottle
  CDN->>SH: /shop/p/steel-bottle
  SH->>ST: rewrite (zones.json: /shop → storefront)
  ST->>ST: RSC render (cached shell via PPR)
  ST->>K: BFF kongFetch GET /api/catalog/v1/products/{id} (server-side, token from session)
  K->>CS: /v1/products/{id} (rate limited, X-Request-ID)
  CS->>CS: verify JWT (if needed), cache-aside Redis
  CS->>DB: SELECT (own database only)
  DB-->>CS: row
  CS-->>ST: product JSON
  ST-->>B: streamed HTML, assets from /shop/_next/* (via shell rewrite)
  B->>SH: click "My orders" (ZoneLink → hard navigation)
  SH->>SH: rewrite /account/orders → account zone
```

## 4.12 Agent widget through the zone BFF

```mermaid
sequenceDiagram
  autonumber
  actor B as Buyer
  participant W as account zone widget (@ac/agent-widget)
  participant BFF as account BFF /account/api/agents/refund/run
  participant K as Kong /api/agents
  participant AG as agents service
  participant OPA as OPA
  participant RS as returns service (via Kong)

  B->>W: "the case is cracked"
  W->>BFF: POST RunAgentInput (cookie session)
  BFF->>BFF: session → access token (never sent to browser)
  BFF->>K: POST /api/agents/v1/agents/refund/run (Bearer user token)
  K->>AG: SSE request (60 req/min/IP limit, buffering off)
  AG->>OPA: authorize tool getOrder (READ)
  OPA-->>AG: allow
  AG->>K: GET /api/order/v1/orders/{id} (agent token: sub=user, act=agent:refund)
  K->>RS: (tools reach every service through Kong)
  AG-->>BFF: AG-UI events (TOOL_CALL_*, TEXT_MESSAGE_*, STATE_*)
  BFF-->>W: stream passthrough
  AG-->>W: RUN_FINISHED outcome interrupt (reason offer)
  B->>W: choose refund
  W->>BFF: new run with resume [interruptId, payload]
```

## 4.13 Contract change across repos (backend → frontend)

```mermaid
sequenceDiagram
  autonumber
  actor DEV as Developer
  participant BE as backend repo
  participant CI as backend CI
  participant REG as npm registry (Verdaccio local · GitHub Packages)
  participant FE as frontend repo
  participant FCI as frontend CI

  DEV->>BE: change libs/contracts (additive field) + changeset (minor)
  BE->>CI: PR → contract tests, affected services build/test
  CI->>CI: merge → changeset version → @ac/contracts 0.3.0
  CI->>REG: publish @ac/contracts@0.3.0
  Note over BE: producing service ships first (expand) — consumers ignore unknown fields
  DEV->>FE: bump @ac/contracts ^0.3.0 in the zones that need it
  FE->>FCI: PR → typecheck, Playwright through shell
  FCI-->>FE: deploy only affected zones
  Note over BE,FE: breaking change? new type version (order.created.v2) or /v2 route, run both, migrate consumers, then remove (contract)
```

## 4.14 Per-service CI/CD pipeline (backend and frontend alike)

```mermaid
flowchart LR
  PR[Pull request] --> AFF["detect affected<br/>turbo --filter=...[origin/main]"]
  AFF --> T["lint · typecheck · unit tests<br/>(per affected service/zone)"]
  T --> IT["integration (Testcontainers)<br/>contract tests · OPA tests · agent evals if agents changed"]
  IT --> IMG["docker build per affected deployable<br/>tag = &lt;name&gt;:&lt;semver&gt;-&lt;sha&gt;"]
  IMG --> SCAN[image scan]
  SCAN --> MERGE{merge to main}
  MERGE --> PUSH["build linux/arm64 on ubuntu-24.04-arm<br/>push ghcr.io/&lt;owner&gt;/ac/&lt;name&gt;:&lt;sha&gt;"]
  PUSH --> APPROVE{"environment prod<br/>manual approval"}
  APPROVE --> DEPLOY["ac k8s deploy prod &lt;name&gt; --tag &lt;sha&gt;<br/>tags.json entry → helm upgrade<br/>only that Deployment rolls"]
  DEPLOY --> SMOKE["smoke: rollout status, /health,<br/>k6 via Kong, Playwright through shell"]
  SMOKE -- "fails" --> RB["ac k8s rollback prod &lt;name&gt;"]
```

## 4.15 Deploy one service to the k3s cluster (and roll back)

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer / CI deploy job
  participant CLI as ac k8s deploy
  participant TAGS as deploy/envs/prod.tags.json
  participant H as Helm (release agentic-commerce)
  participant K as k3s API (ac-apps)
  participant D as Deployment catalog
  participant GH as ghcr.io

  Dev->>CLI: ac k8s deploy prod catalog --tag 1.4.0
  CLI->>TAGS: catalog 1.3.2 → 1.4.0 (previous kept in history)
  CLI->>CLI: ac k8s values + kong --k8s (routes) + OPA bundle
  CLI->>H: helm upgrade --install -f values.services.yaml + envs/prod.json overrides + tags
  H->>K: apply rendered manifests (only catalog's pod template changed)
  K->>D: rolling update (maxUnavailable 0)
  D->>GH: pull ac/catalog:1.4.0 (linux/arm64)
  D-->>K: new pod Ready (GET /health)
  K-->>CLI: rollout status ok
  Note over K: the other 18 Deployments are untouched
  alt smoke test fails
    Dev->>CLI: ac k8s rollback prod catalog
    CLI->>TAGS: restore previous tag 1.3.2
    CLI->>H: helm upgrade (same flow)
    H->>K: catalog rolls back to 1.3.2
  end
```

## 4.16 Request path inside the cluster (NetworkPolicy view)

```mermaid
sequenceDiagram
  autonumber
  actor B as Browser
  participant T as Traefik ingress (TLS)
  participant SH as zone-shell
  participant ZA as zone-account
  participant E as edge (Kong)
  participant O as order service
  participant PG as Postgres ac_orders (ac-infra)

  B->>T: GET https://<domain>/account/orders
  T->>SH: / (Ingress rule)
  SH->>ZA: rewrite /account/* → http://zone-account:3302 (allowed: shell → zones)
  ZA->>E: kongFetch /api/order/v1/orders (allowed: zones → edge)
  E->>O: http://order.ac-apps.svc.cluster.local:4105 (allowed: edge → services)
  O->>PG: own DATABASE_URL (allowed: ac-apps → ac-infra)
  Note over ZA,O: zone → service directly is denied by NetworkPolicy
```
