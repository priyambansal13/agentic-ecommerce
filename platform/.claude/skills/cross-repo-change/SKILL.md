---
name: cross-repo-change
description: "Use when a change spans more than one repo in agentic-commerce — a backend API or event change the frontend (or another service) consumes, a new agent with UI, a new service with a new zone page, or infra needed by code. Plans and sequences the work with expand/contract so every repo and service stays independently deployable. Trigger on \"add field to the API and show it in the UI\", \"change event\", \"feature across backend and frontend\", \"breaking change\"."
---

# Change across repos (platform · backend · frontend)

Repos release independently, so a cross-repo change is a **sequence of compatible releases**, never a
lock-step deploy.

## 1. Map the change
| Piece | Repo / path |
|---|---|
| Design, flows, ADR | `platform/docs` (`architecture-decision` skill) |
| Infra (topic, DB, route, secret) | `platform/infra` (local), `platform/deploy` (k3s charts, `envs/<env>.env` secrets) |
| Contract (DTO / event schema) | `backend/libs/contracts` (published `@ac/contracts`) |
| Provider implementation | `backend/services/<svc>` |
| Consumers | other `backend/services/*`, `backend/services/agents` tools, `frontend/apps/<zone>` |

## 2. Sequence (expand → migrate → contract)
1. **Platform:** docs/ADR; infra prerequisites (`ac infra init` regenerates DBs/topics/Kong from metadata).
2. **Backend contract (additive):** new optional fields, new endpoint or `/v2`, new `*.v2` event published
   **alongside** the old one. `pnpm changeset` (minor for additive, major only for removals).
3. **Backend provider:** implement + tests; deploy. Old consumers keep working.
4. **Publish contracts:** `contracts-release` skill (`ac libs publish` locally, CI → GitHub Packages).
5. **Consumers:** frontend `pnpm update @ac/contracts`, implement, release zones; other services migrate.
6. **Contract (later release):** remove the old field/endpoint/event version once telemetry/consumers
   confirm nobody uses it.

## 3. Breaking-change rules
- Never rename/retype/remove in place. Never change the meaning of an existing field.
- Events: consumers must tolerate unknown fields; producers never drop required fields within a version.
- Agent tools depending on an API follow the same rule (they are consumers too).

## 4. Verify end to end locally
```bash
ac infra up && ac infra init && ac libs publish
ac dev <service> shell <zone>        # e.g. ac dev catalog shell storefront
ac doctor
```
Exercise the flow through the shell (http://localhost:3300) and Kong; run backend + frontend tests.

## 5. PRs
One PR per repo, linked to each other, merged in the sequence above. Each PR must be deployable alone.

## Checklist
- [ ] Docs/ADR updated first (platform)
- [ ] Contract change additive or versioned; changeset added
- [ ] Provider deployed before consumers; old version still served
- [ ] Contracts published; consumers upgraded deliberately
- [ ] Clean-up release planned for the old version
- [ ] End-to-end verified locally through shell + Kong
