---
name: local-infra
description: "Use when setting up a machine, starting/stopping/inspecting the local stack, or troubleshooting it for agentic-commerce (macOS/Linux) — the platform CLI `ac` (setup, repos, configure, infra up/init/status/logs/down/reset, libs publish, dev, doctor), ports, per-service databases, Kong routes, Verdaccio registry and common failures. Trigger on \"set up\", \"start the stack\", \"it doesn't connect\", \"port in use\", \"502 from Kong\", \"reset the database\"."
---

# Local infrastructure & workspace CLI

Everything runs through the zero-dependency platform CLI (Node ≥ 22), from the workspace root:
`node platform/scripts/ac.mjs <cmd>` (from inside a repo: `node ../platform/scripts/ac.mjs <cmd>`).
macOS and Linux only.

## Commands
```bash
./platform/setup.sh                 # first time: tools → repos → configure → infra up → init → libs publish → install → build → doctor
ac tools [--install]                # git, node ≥22, pnpm 12, docker (+ gh, terraform, kubectl, helm, claude); brew on macOS, hints on Linux
ac repos                            # git init / clone backend + frontend (AC_BACKEND_REPO / AC_FRONTEND_REPO URLs)
ac configure                        # platform/.env (secrets source of truth) → backend/services/*/.env, frontend/apps/*/.env.local
ac infra up [--llmops] [--tools]    # containers + wait for health (--llmops Langfuse, --tools OpenSearch Dashboards)
ac infra init                       # idempotent: ac_<db> databases + svc_<db> roles per service, Kafka topics, OpenSearch index, Kong routes
ac libs publish                     # publish backend @ac/contracts + @ac/money to Verdaccio (versions not yet published)
ac install | build | test           # across backend + frontend
ac dev [backend|frontend|<service>|<zone> …]
ac infra status | logs <svc> | down # down keeps data
ac infra reset                      # DESTROYS volumes — ask the user first
ac doctor                           # tools, config, containers, endpoints, running services/zones, OPA policy
ac token [realm user pass]          # dev access token (customers buyer buyer | staff support support)
```
(`ac` = `node platform/scripts/ac.mjs`.)

## Ports
| Component | URL | Notes |
|---|---|---|
| Shell (frontend entry) | http://localhost:3300 | zones: storefront 3301 `/shop`, account 3302, seller 3303, admin 3304 |
| Kong | http://localhost:58000/api/<service>/v1/... | admin :58001; routes generated from backend service metadata |
| Services | 4101–4111, agents 4300 | run on host via `ac dev`; `/health`, `/v1/whoami` |
| Postgres 18 + pgvector | localhost:55432 | one database `ac_<db>` + role `svc_<db>` per service |
| Redis 8 | localhost:56379 | password in platform/.env |
| Kafka (Redpanda) | localhost:59092 · Console http://localhost:58080 | topics from `infra/kafka/topics.json` |
| OpenSearch 3 | http://localhost:59200 | Dashboards :55601 with `--tools` |
| Keycloak 26 | http://localhost:58180 | realms customers/staff from `infra/keycloak/` |
| OPA | http://localhost:58181 | mounts `../backend/policies` |
| Verdaccio (npm) | http://localhost:54873 | `@ac/*` packages for cross-repo sharing |
| MinIO · Mailpit · Grafana | :59000/:59001 · :58025 · :53000 | |
| Langfuse (`--llmops`) | http://localhost:53100 | |

## Troubleshooting
| Symptom | Fix |
|---|---|
| `Docker engine is not running` | start Docker Desktop / OrbStack; Linux: `systemctl start docker` |
| `port is already allocated` | `docker ps --format "{{.Names}} {{.Ports}}"`; stop the other project or change the host port in `infra/docker-compose.yml` + the URL in `.env` |
| OpenSearch exits on Linux | `sudo sysctl -w vm.max_map_count=262144` |
| Kong `502` for `/api/<svc>` | service not running (`ac dev <svc>`); Linux needs `host.docker.internal` (compose sets host-gateway) |
| `password authentication failed for svc_<db>` | `ac configure && ac infra init` (re-syncs per-service passwords) |
| `relation does not exist` | run that service's migrations |
| Frontend install can't find `@ac/contracts` | `ac infra up` (Verdaccio) then `ac libs publish` |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` | pnpm 12 blocks packages < 24 h old; keep Nest packages on one minor; `@ac/*` is excluded in frontend config |
| `Kafka client native module failed to load` | `pnpm rebuild @confluentinc/kafka-javascript` in backend |
| `429` on `/api/agents` | Kong per-IP limit for agent routes (cost guard) |

## Checklist
- [ ] `ac doctor` green before debugging app code
- [ ] Destructive commands (`infra reset`, `down -v`) only with the user's OK
- [ ] New ports/services documented in `docs/06-dev-setup.md`
