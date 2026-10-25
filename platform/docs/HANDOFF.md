# Session handoff — updated 2026-10-23

Context for resuming work (human or Claude Code) on agentic-commerce.

## What exists

| Repo | State |
|---|---|
| `platform/` | Docs 00–08 + ADRs, CLI `scripts/ac.mjs`, `setup.sh`, Docker Compose infra (+ Verdaccio registry), **`deploy/`** (Helm charts `agentic-infra` + `agentic-commerce`, OCI Terraform for one Always Free A1 VM with k3s, `envs/<env>.json` + `<env>.tags.json`), k6 smoke; AWS Terraform **archived** in `terraform-aws-archive/` |
| `backend/` | 12 NestJS microservices (own DB `ac_<db>`, `.env`, Dockerfile, service card), agents service (AG-UI 1.0 + LangGraph + OPA + audit, `ping` agent), libs (`@ac/contracts`, `@ac/money` published; `nest-common`, `kafka` internal), `policies/`, `evals/`, generators |
| `frontend/` | Next.js 16 Multi-Zones: shell 3300, storefront `/shop` 3301, account 3302, seller 3303, admin 3304; packages ui, agui-kit, agent-widget, bff; generators |

All three are git-initialised with **no commits yet**. Each has `CLAUDE.md` + `.claude/skills` + `.claude/agents`.
Verification results: [06-dev-setup.md §6.6](06-dev-setup.md#66-verification-status).

## Decisions (by the user)

Three repos (platform/backend/frontend) · full microservice isolation (DB, container, CI, version per service) ·
Next.js Multi-Zones + shared widgets · macOS/Linux only (Windows dropped) · docs live in the repo as Markdown, not artifacts ·
**no AWS** (2026-10-23) → deploy to **k3s on an Oracle Cloud Always Free VM** (2 OCPU / 12 GB; the other half runs swarm-ai), AWS Terraform archived ([ADR 0011](adr/0011-k3s-on-oracle-cloud.md)).

## Resume locally

```bash
cd ~/Documents/PriyamLearning/Projects/agentic-commerce
alias ac="node $PWD/platform/scripts/ac.mjs"
ac infra up && ac infra init     # containers may still be running; both are idempotent
ac dev                           # all services + zones → http://localhost:3300
ac doctor
```

## Latest: role dashboards (2026-10-23)

Seven role dashboards (buyer `/account`, seller `/seller`, admin `/admin` + `/admin/agents`, support, finance,
fraud, moderation under `/admin/*`) on real per-service read APIs (`@ac/contracts` 0.2.0) with seeded demo data
(`ac seed`) and real Keycloak login (shell `/api/auth/*`). Design: [09-dashboards.md](09-dashboards.md).
Then restyled Amazon-like (Your Account, Your Orders with tabs/order cards/Buy Again, Seller Central home with Global Snapshot + Account Health; contracts 0.3.0, order_lines migration). Not yet re-verified on k3s (images must be rebuilt: new deps + seed scripts; zone secrets now carry AUTH_* vars).

## Latest: marketplace model (2026-10-23)

Who lists / approves / pays — Amazon model, chosen by the user ([10-marketplace.md](10-marketplace.md), [ADR 0012](adr/0012-marketplace-model.md)).
Contracts 0.4.1. user: seller accounts + KYC (GSTIN checksum, PAN↔GSTIN, state, IFSC) + category approvals, grants the Keycloak
`seller` role via client `user-service`. catalog: categories (grocery/beauty/jewellery gated), Brand Registry + authorized resellers,
shared catalogue (products + offers), listing rules (422 codes), public search/product APIs. admin: rules pre-screen (stand-in for the
moderation agent; auto-approves ≥ 0.9) + moderator decisions. payment: versioned fee schedule (referral % per category, closing-fee
bands, 2 % payment fee, 18 % GST) with maker-checker, fee preview, `order_fees`, FEE ledger. New staff roles/users: compliance,
brand-team (`brands`), category-team (`category`). UI: `/seller/register|account|categories|brands|listings|fees`, `/shop` real
catalogue + `/shop/p/[id]`, `/admin/compliance|brands|categories|fees`, moderation buttons. Verified end to end in a real browser
(apply → verify → re-login → gated category → product with live fee preview → auto-published → searchable; fee v2 draft → submit →
self-approval refused → admin approves). Demo state reset afterwards (`buyer` has no seller account).
Gaps: fees not yet recorded on live orders (order events lack category); `catalog.offer_created.v1` not consumed by inventory; not on k3s yet.

## Latest: images + UI overhaul (2026-10-23)

Contracts 0.5.0. Product photos: 52 product types × 2–3 free-licence photos (Wikimedia/Flickr via Openverse; CC0/PDM/CC BY only,
credits in `backend/libs/demo-data/src/images.json`) + 8 category banners, stored in MinIO bucket `ac-catalog` (user `svc-catalog`,
`"objectStore": true` metadata → `ac configure`/`infra init`/k8s bootstrap). Catalog serves WebP thumb/card/full, seller uploads
(≤ 5 per product, type/size/owner checks). UI: Amazon-style home (hero, category cards, shelves), image shop + product gallery,
order/Buy Again photos, Seller Central photo picker + manage photos, console icons, moderation photos. Beauty/Books/Jewellery now
have products. Shell proxies `/api/*/v1/*` to Kong in dev (fallback rewrite). Gaps: image moderation, shop price filters/sort, k3s.
Note: some services were last started with `node dist/main.js` instead of `ac dev` — restart with `ac dev` for watch mode.

## Latest: P2 transactions (2026-10-24)

Contracts 0.6.1. Cart (signed-in + guest via `X-Cart-Session`/`ac_cart` cookie, merged at login; guest carts in Postgres, not Redis —
pnpm dedupe issue), checkout saga in order (re-price via catalog `/offers` → fraud score 300 ms → inventory reserve 15 min → payment
session; compensations), stock per offer with conditional reservations + expiry sweeper, payments via `testpay` (test cards, signed
webhooks, dedupe; Stripe adapter only with keys), balanced ledger + fees on live orders + refunds on cancel, order lifecycle (cancel,
ship with tracking, demo carrier delivers after `DEMO_DELIVERY_MINUTES`=3), emails to Mailpit, service-to-service `ServiceClient`
(client credentials of `services`, realm role `service`, `"calls"` metadata). UI: buy box, cart, checkout, test pay page, thanks,
order details tracker + cancel, seller Manage Orders + Inventory. Verified: browser checkout E2E 27/27, marketplace E2E 17/17,
flash sale 1000 → exactly 100 reserved (p95 ≈ 19 s: hot-row contention; Redis admission token not built). ADR 0014 (testpay).
Gaps: Redis hot-SKU admission + display cache, Stripe live test (no keys), Razorpay, payouts/reconciliation, REVIEW orders not held,
partial-refund fee adjustment, notifications API, k3s not re-verified.

## Latest: P3 agent platform + returns (2026-10-24) — PAUSED mid-verification

Built (contracts **0.7.1**, published to Verdaccio; frontend on ^0.7.1):
- **returns service** — return requests, deterministic policy engine R1–R8, refund cases, dual control above ₹25,000
  (support then finance, different people), auto envelope ≤ ₹2,000 with risk < 0.3, evidence photos in MinIO
  (dhash `reused_photo` detection), hash-chained decisions, events `returns.case_proposed/decided/refund_executed.v1`.
- **agents service** — LangGraph refund agent; modes SHADOW/RECOMMEND/LIVE, autonomy L0–L4 (refund default **L1**, max L3),
  OPA money envelope, Redis budgets + kill switch, audit chain, `MODEL_PROVIDER=auto|openai|offline` (offline used — no
  OpenAI key yet), evals 312 cases + 48 red-team with CI gate (offline: 97.8 %, 0 unauthorized MONEY calls).
  Keycloak client `agents` (roles service + agent, `X-Agent-Act`, ADR 0015).
- **frontend** — account `/account/returns{,/new,/[id]}` (photo upload, timeline, appeal); admin `/admin/support/[caseId]`
  (claim, items, evidence, policy, agent proposal for admin/L2+, approve/reject), `/admin/finance` second-approval queue,
  `/admin/agents` (autonomy control, shadow agreement, eval gate, runs). Routes in 08 §8.9.2.

Verified 2026-10-24: browser returns E2E 27/27 (`scratchpad/shots/returns-e2e.mjs`, env ORDER_ID + BIG_ORDER_ID;
`big-order.mjs` makes a delivered >₹25k order): return with photo → support approves → "Refund issued"; dual control
support → finance → refunded; autonomy L1→L2→L1; no overflow at 390 px. returns 39 / agents 30 / fraud 4 unit tests pass.

Fixed in the final integration pass:
- agent sent pincode `000000` (blocked) when unknown → now `''`.
- fraud `POST /internal/risk/score` gains `purpose: 'checkout'|'refund'` (0.7.1): refund = read-only (checkout score if
  any, else evaluated without storing / velocity) — agent lookups had polluted velocity and cached a 1.00 score.
- `CaseDetail.lines` (0.7.1) + "Items being returned" panel on the case page.
- **Postgres "recovery mode" root cause**: Postgres was PID 1, so `docker exec` children (healthcheck `pg_isready` killed
  on timeout, psql SIGPIPE) were reaped by the postmaster as crashed backends → full reset. Fixed with `init: true` in
  `infra/docker-compose.yml` (container recreated via `ac infra up`, data kept).

**Resume here** (in order):
1. Re-run regressions (were interrupted): `node scratchpad/shots/checkout-e2e.mjs` (P2, expect 27/27) and `e2e.mjs`
   (marketplace, needs `reset.sh` first because it re-applies the buyer as a seller).
2. Reset demo state: scratchpad `reset.sh`, then `node platform/scripts/ac.mjs seed returns`.
3. Report P3 to the user; then add `MODEL_*` to the Helm chart for agents, and re-verify on local k3s.
P3 gaps: real OpenAI evals (add key via `ac configure`, re-run evals), per-autonomy token scopes, resume a run after the
buyer adds a photo (the agent may run before the photo lands → `needs_photo` signal), daily audit export, refund-specific
fraud signals, fraud call times out (1.5 s) under load → agent falls back to risk 0.50 (never auto-executes).
Scratchpad = `/private/tmp/claude-501/-Users-priyambansal-Documents-PriyamLearning-Projects/956477c4-8750-411c-ade3-46d9431c5241/scratchpad`
(may be wiped on reboot; scripts are throwaway). Dev stack runs detached: `nohup node platform/scripts/ac.mjs dev > …/ac-dev.log 2>&1 &`,
stop with `pkill -f "ac.mjs dev"`.

## Open items / next steps

1. ~~Commit~~ done 2026-10-25: one monorepo pushed to https://github.com/priyambansal13/agentic-ecommerce (`main`); CI = root `.github/workflows/{platform,backend,backend-release-libs,frontend}.yml`, path-filtered. Deploy jobs need GitHub secrets PROD_KUBECONFIG / PROD_ENV + a `prod` environment; image pushes go to ghcr.
2. ~~Login in zones~~ done (own OIDC in `@ac/bff`); next: dashboard actions (approve/reject refunds, moderation decisions) via command APIs with Idempotency-Key + dual control.
3. Phase 1 business features ([roadmap](05-roadmap.md)): catalog CRUD, search indexer, storefront pages.
4. Agent token exchange (Keycloak RFC 8693), Redis-backed budgets/kill switch, first real agent (refund, shadow mode).
5. k8s deployment verified locally on k3s-in-Docker 2026-10-23 (all 19 Deployments, routing, auth, NetworkPolicies, per-service release + rollback, backups — see 06 §6.6). First real deploy to Oracle Cloud: `ac tf oci apply` → DNS → `ac k8s kubeconfig prod` → `ac k8s secrets prod` → push arm64 images to ghcr → `ac k8s deploy prod` ([06 §6.9](06-dev-setup.md#69-deploy-to-oracle-cloud-k3s)). Single node = no HA — set up off-box backup copies.
6. Unused/archived: MSK IAM auth in `@ac/kafka` (opt-in), `terraform-aws-archive/`.

## Gotchas learned

- pnpm 12: `allowBuilds:` (not `onlyBuiltDependencies`); minimum-release-age blocks packages < 24 h old → Nest pinned `~12.1.3`, frontend exempts `@ac/contracts`/`@ac/money`.
- Backend sets `sideEffectsCache: false` (a truncated Kafka native binary got cached once).
- Frontend `.dockerignore` must exclude `*.tsbuildinfo`, otherwise images build with empty `dist/`.
- Keycloak volume mounts at `/opt/keycloak/data`; Postgres extensions live in `template1` so per-service DBs inherit them.
- Kong limits `/api/agents` to 60 req/min per IP (by design) — load tests must probe agents lightly.
- k3s NetworkPolicy controller admits NEW pods a few seconds after start → Jobs must wait/retry before connecting (backup, index, topics, db-bootstrap do).
- `helm --wait` blocks on PVCs that have no consumer (local-path binds on first use) — keep volumes inside StatefulSets.
- `admin` is both a service and a zone → zones are always addressed as `zone-<name>` in `ac docker`/`ac k8s`.
- Server-action redirects in a zone must be **absolute URLs** (`NEXT_PUBLIC_APP_URL` + basePath): a form posted before hydration loses the basePath on a relative redirect.
- Existing local Keycloak volumes don't re-import realm JSON — new roles/users/clients must be added via the admin console/kcadm (or `ac infra reset`, destructive).
- TypeORM raw `UPDATE … RETURNING` returns `[rows, count]` — check `rows.length`, not the outer array, for optimistic-version conflicts.
- Running `pnpm build` in backend while `ac dev` watchers run wipes `dist` and crashes them — `ac seed` therefore builds only the libs for services already listening and seeds from the watcher's `dist`.
- Postgres "recovery mode" crashes were NOT memory: Postgres as PID 1 reaped killed `docker exec` children (healthcheck timeouts) as crashed backends. Fixed with `init: true` on the postgres service. The Docker VM (7.6 GB) is still shared with MediCare/PayFlow stacks.
- `nest start --watch` doesn't restart a crashed service on `touch` (unchanged output) — restart `ac dev`.
- Local k3s: `ac k8s local up|down`, ingress http://localhost:8088 (container `ac-k3s`, ~4 GB RAM).
