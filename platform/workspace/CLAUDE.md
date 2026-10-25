# CLAUDE.md — agentic-commerce workspace

This folder is the **agentic-commerce monorepo** (github.com/priyambansal13/agentic-ecommerce) with three
independent projects — open Claude Code inside the folder you are changing to get its skills and agents; use this
file for cross-project orientation. CI lives in the root `.github/workflows/` (one workflow per folder, path-filtered).

| Folder | What lives there | Its guide |
|---|---|---|
| `platform/` | docs (source of truth), local infra (docker compose), workspace CLI `ac`, k3s deployment on Oracle Cloud (`deploy/`: Helm charts, OCI Terraform, env manifests), k6 load tests | `platform/CLAUDE.md` |
| `backend/` | microservices (`services/*`, one database + image + CI each), agents service (LangGraph + AG-UI + OPA), shared libs (`@ac/contracts`, `@ac/money` published), OPA policies, evals | `backend/CLAUDE.md` |
| `frontend/` | Next.js Multi-Zone micro-frontends: shell `/`, storefront `/shop`, account `/account`, seller `/seller`, admin `/admin`; shared `@ac/ui`, `@ac/agui-kit`, `@ac/agent-widget`, `@ac/bff` | `frontend/CLAUDE.md` |

## How they connect
```
browser → shell :3300 ──rewrites──► zone apps :3301–3304 ──BFF (server)──► Kong :58000 ──► services :4101–4111, agents :4300
backend libs @ac/contracts, @ac/money ──publish──► registry (Verdaccio :54873 / GitHub Packages) ──► frontend
services ⇄ Kafka (events, outbox) · each service ⇄ its own Postgres database
```

## Everyday commands (from here)
```
./platform/setup.sh                      # one-time setup of everything
node platform/scripts/ac.mjs doctor      # health of tools, infra, services, zones
node platform/scripts/ac.mjs dev         # run all services + zones → http://localhost:3300
```

## Cross-repo work
Contract/API/event changes follow the platform skill `cross-repo-change` (expand → migrate → contract,
backend first, publish contracts, then frontend). Design changes start with an ADR
(`architecture-decision`). Releases: `release-checklist`; deploying to the k3s cluster (Oracle Cloud VM, or
k3s-in-Docker `local`): `k8s-deploy`. Production deploys/rollbacks/`tf oci apply` only with the user's go-ahead.
AWS is not used (archived in `platform/terraform-aws-archive/`).

## Rules that span repos
Database per service · services talk only via Kong/HTTP or Kafka events · contracts are versioned and
backwards compatible · every service and zone deploys independently · zones never import each other ·
no tokens in browser code · agents propose, services dispose (OPA + human interrupts for money) ·
money in minor units · docs in `platform/docs` move with code · in the cluster services are reachable
only through Kong (NetworkPolicies) and everything must fit one 12 GB node.
