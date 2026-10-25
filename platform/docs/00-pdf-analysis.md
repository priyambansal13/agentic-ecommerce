# 0. Source Design Analysis & Gaps

Source: *Design an E-Commerce Platform (aka Amazon)* — "Mastering System Design", Section 22 (15 slides).

## 0.1 What the PDF specifies

### Scope
A multi-vendor marketplace: browse/search, seller listings & inventory, cart & checkout, payments with
basic fraud detection. Must be scalable, secure and consistent.

### Actors
| Actor | Capabilities |
|---|---|
| Buyer | Search, browse, add to cart, pay, track orders |
| Seller | List products, manage stock, handle orders, track earnings/payouts |
| Admin | Moderate content, monitor platform health, resolve disputes |

### Functional requirements
1. Registration & authentication (buyers/sellers)
2. Product catalog management
3. Inventory consistency during checkout
4. Cart & order management
5. Secure payment processing
6. Basic fraud detection & alerts
7. Seller dashboard (sales, products, payouts)

### Non-functional requirements
| NFR | Target |
|---|---|
| Performance | < 300 ms for common search/browse queries |
| Scalability | ~10k concurrent users at launch, elastic growth |
| Availability | 99.9 % (≈ 43 min downtime/month); catalog, cart, checkout fault-tolerant |
| Security | OAuth2/OIDC + JWT; PCI-DSS best practices |
| Consistency | Strong consistency for inventory during checkout |
| Maintainability | Modular services; easy seller/product onboarding |

### Scale estimates
| Metric | Value | Derived |
|---|---|---|
| Registered users | ~1 M | |
| DAU | ~10 k | |
| Peak traffic | ~100 RPS (sales) | Small — one Postgres primary handles this comfortably |
| Catalog | ~500 k products | ~1–2 GB index in OpenSearch incl. vectors (1536-d float ≈ 6 KB/doc → ~3 GB; use 512-d or int8 quantization) |
| Orders | ~1 k/day | ~0.01 orders/s average; flash-sale bursts are the real risk |
| Sellers | ~5 k active | |

### Constraints & assumptions
- MVP in 3–4 months, budget-constrained, **minimal DevOps/SRE** → managed services, few deployables.
- **No AWS (2026-10-23):** AWS cannot be used. Target = **Oracle Cloud Always Free** (one Ampere A1 VM, 2 OCPU / 12 GB) running **k3s**; in-cluster Postgres, Redpanda, OpenSearch, Redis, Keycloak, MinIO instead of managed services ([ADR 0011](adr/0011-k3s-on-oracle-cloud.md)).
- External gateway (Stripe/Razorpay) handles card data.
- No warehouse/logistics — sellers ship.
- Fraud is rule-based (no ML yet); search is keyword-based (no personalization).
- PCI-DSS basics, GDPR.

### Services, APIs, communication (from the slides)
- Services: User, Product Catalog, Inventory, Order Management (incl. cart), Payment, Notification, Admin.
- APIs: `POST /register`, `POST /login`, `GET /profile`, `GET /products`, `GET /products/{id}`,
  `POST /products`, `GET /inventory/{productId}`, `POST /reserve-stock`, `POST /cart/add`,
  `POST /checkout`, `GET /order/{orderId}`, `POST /payments/initiate`, `POST /payments/verify`.
  RESTful, stateless, versioned (`/v1`).
- Sync REST between User/Catalog/Inventory/Orders/Payments; async events:
  `OrderPlaced → InventoryUpdate → Notification`, `PaymentSuccess → OrderConfirmation → NotifySeller`.
- Stores: PostgreSQL per service, Elasticsearch/OpenSearch for search, Redis caches, Kafka/SQS/RabbitMQ, S3 for logs/events.

### Final diagram (slide 15)
Clients (Web, Mobile) → API Gateway (NGINX/Kong/APIM: routing, rate limiting, authN/Z, validation,
monitoring) → five microservices each with **Redis cache + own PostgreSQL** (Catalog also feeds a search
index) → domain events (`UserRegistered`, `ProductUpdated`, `InventoryUpdated`, `OrderCreated`,
`PaymentCompleted`) on an **Event Bus** → Message Queue for background jobs → Notification Service →
Email/SMS provider. Payment Service ↔ external Payment Gateway (with async callback).

## 0.2 Gaps & risks in the source design (and our decisions)

| # | Gap / risk | Why it matters | Decision in this plan |
|---|---|---|---|
| G1 | No **reservation expiry** or saga for checkout | Abandoned checkouts lock stock forever; partial failures leave inconsistent state | Reservations with TTL + expiry sweeper; checkout saga (orchestrated by Order Service) with compensations — see [LLD §2.5](02-lld.md#25-order-service-cart--checkout--order-lifecycle) |
| G2 | Events published directly after DB write (dual-write) | Lost or phantom events on crash | **Transactional outbox** per service → Kafka |
| G3 | No **idempotency** on checkout/payment | Double charges on retries/double clicks | `Idempotency-Key` header on all mutating money/stock APIs; Stripe idempotency keys; webhook dedupe table |
| G4 | `POST /payments/verify` implies client-driven verification | Client can lie; payment truth must come from gateway | Gateway **webhooks** are the source of truth; `verify` only for Razorpay signature check, server-side |
| G5 | Redis caching of **stock levels** | Stale cache → overselling if used for decisions | Redis stock is *display only*; reservation always hits Postgres with a conditional update |
| G6 | Refunds listed under Payment but no **returns/refund workflow** | Refunds are a top support cost and fraud vector | New **Returns & Refunds Service** + governed **Refund Agent** |
| G7 | No **payout/ledger** design for sellers | Seller dashboard needs earnings & payouts; money must reconcile | Double-entry **Ledger** module in Payment Service; Stripe Connect / Razorpay Route for split payouts |
| G8 | Admin "resolve disputes" undefined | | **Dispute Service** module in Admin + Dispute Agent with HITL |
| G9 | Fraud is rule-based only | Fine for MVP, but alerts need triage | Rules engine stays the decision-maker; **Fraud Investigation Agent** triages alerts for analysts |
| G10 | Search is keyword-only | Poor recall for natural-language queries | Hybrid search (BM25 + vectors) in OpenSearch; LLM query understanding is **optional and off the hot path budget** |
| G11 | 7 microservices + Kafka for "minimal DevOps" | Operational load contradicts constraint | **Decision (2026-10-20, product owner): full microservice isolation** — every service is its own deployable (container, CI pipeline, version) with **its own database** (`ac_<db>`, role `svc_<db>`); communication only via Kong (sync) and Kafka (async). The UI is split into **Next.js Multi-Zones** micro-frontends. Code lives in three repos: `platform`, `backend`, `frontend`. *Trade-off acknowledged:* ~17 deployables and 11 databases is more ops than 100 RPS needs; mitigated with one service template, generated Kong routes and Helm values, per-service pipelines, and a single k3s cluster on Oracle Cloud Always Free (no managed services — AWS unavailable, [ADR 0011](adr/0011-k3s-on-oracle-cloud.md)). See [07-microservices.md](07-microservices.md), [08-microfrontends.md](08-microfrontends.md) |
| G12 | No observability details beyond "monitoring" | | OpenTelemetry traces across HTTP + Kafka + LLM calls; Langfuse for agent traces |
| G13 | GDPR mentioned but no data lifecycle | | PII inventory, right-to-erasure job, LLM prompts redact PII, no training on customer data (OpenAI API default) |

## 0.3 What we add: the Agentic layer (summary)

| Agent | Users | Autonomy level | AG-UI? |
|---|---|---|---|
| Refund & Returns Agent (flagship, governed) | Buyer, support | Auto-execute within policy; HITL above thresholds | Yes |
| Shopping Assistant | Buyer | Read + suggest; cart actions need user confirm | Yes (generative UI) |
| Order Support (WISMO) Agent | Buyer | Read-only + hand-off | Yes |
| Seller Listing Copilot | Seller | Drafts only; seller publishes | Yes (shared state) |
| Seller Insights & Restock Agent | Seller | Read-only analytics + suggestions | Yes |
| Catalog Moderation Agent | Admin (async) | Auto-approve low-risk, flag the rest | No (Kafka-driven), admin review UI |
| Fraud Investigation Agent | Fraud analyst | Recommend only; rules + human decide | Yes (analyst console) |
| Dispute Resolution Agent | Admin | Recommend; human decides | Yes |
| Notification Composer | System | Templates + LLM copy within approved slots | No |
| Ops Copilot | Admin/SRE | Read-only observability queries | Optional |

Full detail and pros/cons per segment: [03-agentic-ai.md](03-agentic-ai.md).

## 0.4 Architecture style chosen

| Concern | Choice | Doc |
|---|---|---|
| Backend | Microservices, full isolation (own DB / container / pipeline / version per service) | [07](07-microservices.md) |
| Frontend | Micro-frontends with Next.js 16 Multi-Zones behind a shell zone; shared widgets as versioned packages | [08](08-microfrontends.md) |
| Repos | `platform` (infra, Helm charts, OCI Terraform, docs, CLI) · `backend` (services, agents, libs, policies) · `frontend` (zones, shared packages) | [05 §5.1](05-roadmap.md#51-repository-topology) |
| Dev OS | macOS / Linux | [06](06-dev-setup.md) |
| Hosting | k3s on one Oracle Cloud Always Free A1 VM; one Deployment per service/zone; NetworkPolicies; ghcr images (arm64) | [01 §1.8](01-hld.md#18-deployment--infrastructure--k3s-on-oracle-cloud) |
