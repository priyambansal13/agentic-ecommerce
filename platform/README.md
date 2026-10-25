# agentic-commerce / platform

Architecture, local infrastructure, workspace tooling and the **k3s deployment on Oracle Cloud** for an Amazon-style
marketplace with **governed AI agents**, built as **microservices** ([backend](../backend)) and
**micro-frontends** ([frontend](../frontend)). Based on the *"Design an E-Commerce Platform (aka Amazon)"*
system design (Section 22), extended with refund, shopping, seller, moderation, fraud and dispute agents.

> Status (2026-10-23): plan + Phase 0 foundation, split into three repos. Hosting: k3s on one Oracle Cloud
> Always Free VM — AWS is not used ([ADR 0011](docs/adr/0011-k3s-on-oracle-cloud.md)). Business features start
> in Phase 1 ([roadmap](docs/05-roadmap.md)).

## Quick start (macOS / Linux)

```bash
./platform/setup.sh                      # from the workspace folder (agentic-commerce/)
alias ac="node $PWD/platform/scripts/ac.mjs"
ac dev                                   # all services + zones → http://localhost:3300
ac doctor
```

## Deploy (Oracle Cloud, k3s)

```bash
ac tf oci init && ac tf oci apply        # one Always Free Ampere A1 VM (2 OCPU / 12 GB) with k3s
ac k8s kubeconfig prod && ac k8s secrets prod
ac k8s deploy prod                        # agentic-infra (ns ac-infra) + agentic-commerce (ns ac-apps)
ac k8s deploy prod catalog --tag 1.4.0    # later: one service at a time; ac k8s rollback prod catalog
```
Try the charts on your laptop first: `ac k8s local up && ac k8s local load && ac k8s deploy local` →
http://localhost:8088. Full steps: [docs/06-dev-setup.md §6.9](docs/06-dev-setup.md#69-deploy-to-oracle-cloud-k3s).

## Documents

| # | Doc | Contents |
|---|---|---|
| 0 | [PDF analysis & gaps](docs/00-pdf-analysis.md) | Source design, gaps, decisions |
| 1 | [High-Level Design](docs/01-hld.md) | Architecture, repo topology, services, data, security, micro-frontends, deployment |
| 2 | [Low-Level Design](docs/02-lld.md) | Per-service anatomy, schemas, APIs, events, state machines |
| 3 | [Agentic AI](docs/03-agentic-ai.md) | Agent catalog, governance, zone placement, pros & cons per segment |
| 4 | [Flows](docs/04-flows.md) | Sequence diagrams incl. micro-frontend request, agent widget, contract change, CI/CD |
| 5 | [Roadmap](docs/05-roadmap.md) | Repos, phases, teams, testing, cost, risks, ADRs |
| 6 | [Developer setup](docs/06-dev-setup.md) | Setup, CLI, endpoints, verification status, skills & agents, troubleshooting |
| 7 | [Microservices](docs/07-microservices.md) | Service catalog, communication, data ownership, versioning, resilience |
| 8 | [Micro-frontends](docs/08-microfrontends.md) | Zones, routing, shared packages, BFF, agent widgets |
| 9 | [Role dashboards](docs/09-dashboards.md) | One dashboard per role, owning services, login flow, demo data |
| 10 | [Marketplace model](docs/10-marketplace.md) | Who lists and approves (sellers/KYC, Brand Registry, gated categories, moderation), shared catalogue, fee schedule |
| — | [Session handoff](docs/HANDOFF.md) | Current state, decisions, next steps, gotchas |
| — | [Deploy](deploy/README.md) | k3s on Oracle Cloud: Helm charts, OCI Terraform, envs, secrets, release manifests |
| — | [ADR 0011](docs/adr/0011-k3s-on-oracle-cloud.md) | Why k3s on an Oracle Cloud Always Free VM (AWS archived) |

## Layout

| Path | What |
|---|---|
| `scripts/ac.mjs` | Workspace CLI — discovers services (`backend/services/*/package.json` → `"ac"`) and zones (`frontend/zones.json`) |
| `setup.sh` | Bootstrap: Node 22+, pnpm 12 → `ac setup` |
| `infra/` | Docker Compose (Postgres+pgvector, Redis, Redpanda, OpenSearch, Keycloak, Kong, OPA, MinIO, Mailpit, Grafana LGTM, Verdaccio, Langfuse), init SQL, realms, topics, index mapping |
| `deploy/` | `helm/agentic-infra` + `helm/agentic-commerce` (Deployment per service/zone, NetworkPolicies), `terraform/oci` (A1 VM + k3s), `k3s/traefik-config.yaml`, `envs/<env>.json` + `<env>.tags.json` |
| `terraform-aws-archive/` | archived AWS design (not used) |
| `tests/load/` | k6 smoke through Kong and the shell |
| `workspace/` | README/CLAUDE.md copied to the workspace root |
| `.env` | local secret source of truth (generated, gitignored) |

Claude Code: `CLAUDE.md`, skills in `.claude/skills/` (local-infra, k8s-deploy, cross-repo-change, contracts-release,
release-checklist, architecture-decision), agents in `.claude/agents/` (architect, devops-engineer,
security-reviewer, docs-sync).
