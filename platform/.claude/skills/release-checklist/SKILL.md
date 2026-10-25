---
name: release-checklist
description: "Use before merging or deploying anything in agentic-commerce across the three repos — determines which services/zones/infra are affected, runs the right builds, tests, policy tests, agent evals, Helm/Terraform checks and reviews, and orders deployments so every service and zone stays independently deployable. Trigger on \"ready to merge\", \"release\", \"deploy to staging/prod\", \"what do I need to check\"."
---

# Release checklist (workspace)

## 1. Blast radius
| Changed | Checks | Reviewer |
|---|---|---|
| `backend/services/agents/**`, `backend/policies/**`, `backend/evals/**` | policy tests, evals | `governance-reviewer` (backend) |
| `backend/services/{inventory,order,payment,returns}/**`, events | integration tests | `consistency-reviewer` (backend) |
| `backend/libs/contracts/**` | contract tests, all services build, changeset, `contracts-release` | — |
| `backend/services/*/src/migrations/**` | up/down, expand/contract, old version compatible | `consistency-reviewer` |
| auth, tokens, PII, secrets, `platform/infra/keycloak`, Kong | — | `security-reviewer` |
| `frontend/packages/**` | all zones build | `frontend-reviewer` |
| `frontend/apps/<zone>/**` | zone build, Playwright through the shell | `frontend-reviewer` |
| `platform/deploy/helm/**`, `deploy/envs/*.json` | `helm lint` + `helm template` both charts; deploy to `ac k8s local` and smoke | `devops-engineer`, `security-reviewer` (NetworkPolicies, Secrets) |
| `platform/deploy/terraform/oci/**` | `fmt -check`, `validate`, plan reviewed by a human | `devops-engineer`, `security-reviewer` |
| `platform/infra/**`, `scripts/ac.mjs` | `ac infra up && ac infra init && ac doctor` | `devops-engineer` |

## 2. Run
```bash
# backend
cd backend && pnpm exec turbo run build lint test --filter=...[origin/main]
node ../platform/scripts/ac.mjs policy test
pnpm --filter @ac/agents run evals -- --agent <id>          # each changed agent
docker build -f services/<svc>/Dockerfile .                 # each changed service
# frontend
cd ../frontend && pnpm exec turbo run build lint test --filter=...[origin/main] && pnpm exec playwright test
# platform
cd ../platform && terraform -chdir=deploy/terraform/oci fmt -check && node scripts/ac.mjs doctor
node scripts/ac.mjs k6 smoke.js                             # hot paths changed
node scripts/ac.mjs k8s values && helm lint deploy/helm/agentic-commerce deploy/helm/agentic-infra
node scripts/ac.mjs k8s local up && node scripts/ac.mjs k8s local load <names> && node scripts/ac.mjs k8s deploy local
```

## 3. Deploy order
infra (`agentic-infra`) → backend contracts/providers (expand) → backend consumers → libs publish →
frontend zones → shell (if routing changed) → contract clean-up later. Each step deployable and
rollbackable alone: `ac k8s deploy prod <name> --tag <sha>` (one entry in `deploy/envs/prod.tags.json`),
undo with `ac k8s rollback prod <name>`. `ac tf oci plan` is reviewed by a human; never `apply`, deploy or
roll back prod without the user's explicit go-ahead. Single node: deploy one unit at a time and watch
`ac k8s status prod`.

## Checklist
- [ ] Affected services/zones identified; only they are rebuilt/deployed
- [ ] Tests, policy tests, evals green (real output)
- [ ] Reviews done per table
- [ ] Docs + service cards + ADRs updated
- [ ] Deploy order respects expand/contract; rollback plan per unit (previous tag in the manifest)
- [ ] Images built for linux/arm64 and pushed to ghcr; tags manifest updated in the same PR
