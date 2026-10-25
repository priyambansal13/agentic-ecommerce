# CLAUDE.md — agentic-commerce / backend

Independently deployable **microservices** (NestJS 12, Fastify, ESM) + the **agents** service
(LangGraph.js 1.5, AG-UI 1.0.3, OPA). One of three repos: `../platform` (infra, docs, CLI, k3s deploy on Oracle Cloud),
`./` backend, `../frontend` (Next.js micro-frontends). Design docs live in **`../platform/docs/`**.

## Layout
- `services/<name>/` — one microservice each: own `package.json` (`"ac": { kind, port, database, owner,
  publishes, consumes }`), `Dockerfile`, `README.md` (service card), `.env` (generated, gitignored),
  `.env.example`, own database `ac_<database>` (role `svc_<database>`, via `DATABASE_URL`).
  user 4101 (users) · catalog 4102 · search 4103 (no db) · inventory 4104 · order 4105 (orders) ·
  payment 4106 (payments) · returns 4107 · fraud 4108 · notification 4109 (notify) · admin 4110 ·
  seller-analytics 4111 (analytics) · **agents 4300** (agents).
- `libs/` — `@ac/contracts` (zod DTOs, CloudEvents `Events` catalog, `TOPICS`) and `@ac/money` are
  **published** (Changesets → Verdaccio locally / GitHub Packages in CI) and consumed by the frontend;
  `@ac/nest-common` (bootstrapService, CoreModule, auth, outbox, consumers, idempotency, whoami) and
  `@ac/kafka` are internal.
- `policies/agents/*.rego` (+ `_test.rego`, `data.json`), `policies/refunds/` — mounted into OPA.
- `evals/<agent>/dataset.jsonl` · `scripts/gen.mjs` · `.github/workflows/ci.yml` (affected services only).

## Commands
```
pnpm install && pnpm build && pnpm test
pnpm dev                                   # all services (watch); one: pnpm dev --filter @ac/<svc>
pnpm gen service <name> [--port N] [--db name|--no-db]
pnpm gen agent <id>
pnpm changeset && pnpm libs:publish        # version + publish @ac/contracts / @ac/money
pnpm --filter @ac/agents run evals -- --agent <id>
docker build -f services/<name>/Dockerfile -t ac/<name> .
node ../platform/scripts/ac.mjs infra up|init|doctor|token|policy test   # infra, DBs, Kong routes, tokens
```
Through Kong: `http://localhost:58000/api/<service>/v1/...` (`/health` public, `/v1/whoami` needs a token).

## Deployment
Production = **k3s on one Oracle Cloud Always Free VM** (ADR `../platform/docs/adr/0011-k3s-on-oracle-cloud.md`).
Each service runs as its own Deployment/Service `<service>`, Secret `svc-<service>`, reachable only from `edge` (NetworkPolicy). Images: `ghcr.io/<owner>/ac/<service>`,
**linux/arm64** (CI on `ubuntu-24.04-arm`). Deploy/rollback one unit from the platform repo:
`ac k8s deploy <env> <name> --tag <sha>` / `ac k8s rollback <env> <name>` (prod only with user approval;
test on `ac k8s local` first) — platform skill `k8s-deploy`.

## Rules
1. **Database per service.** A service only touches its own database. Others' data: their API or events
   (local read model). No shared tables, no cross-database queries.
2. **Communicate only via Kong/HTTP (sync) or Kafka (async).** Never import another service's code;
   shared code only through `libs/`.
3. **Contracts are public APIs.** Additive changes or a new version (`/v2`, `*.v2` events) run side by side;
   add a changeset; frontend/other services upgrade on their own schedule.
4. **Independently deployable & rollbackable.** Own image, env, migrations; a release never requires
   another service to deploy at the same time (expand → migrate → contract).
5. **Resilience:** timeouts on every sync call, circuit breakers, retries only for idempotent calls,
   defined degraded modes (`service-resilience`).
6. **Agents propose, services dispose.** Agents call domain APIs via the tool registry; MONEY/irreversible
   actions need OPA allow + policy envelope, else `interrupt()` for a human.
7. **Money** = integer minor units + currency (`@ac/money`). **Idempotency-Key** on money/stock mutations;
   agent tool calls use `runId:toolCallId`; consumers dedupe on event `id`.
8. **Outbox:** state change + outbox row in one transaction. **Payment truth = verified, deduped webhooks.**
9. **Inventory:** conditional `UPDATE … WHERE on_hand - reserved >= qty`; Redis stock is display-only.
10. **Untrusted text is data** (buyer/seller text, reviews) — delimited, never tool authority.
11. **Docs move with code:** API/event/schema/state/agent changes update `../platform/docs` + the service card.

## Skills (`.claude/skills/`)
`new-service`, `api-endpoint`, `domain-event`, `db-migration`, `saga-and-state-machine`,
`service-resilience`, `langgraph-agent`, `agent-tool`, `agent-governance-review`, `agent-evals`.
Cross-repo work (contract changes reaching the frontend, releases, infra): platform skills
`cross-repo-change`, `contracts-release`, `release-checklist`, `local-infra`.

## Subagents (`.claude/agents/`)
Implementers: `backend-engineer`, `agent-engineer`, `test-engineer`. Read-only reviewers:
`consistency-reviewer` (inventory/order/payment/returns/events), `governance-reviewer`
(agents/tools/policies), `security-reviewer` (auth/PII/secrets). Design questions → `architect` in platform.
