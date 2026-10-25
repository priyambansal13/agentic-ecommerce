---
name: frontend-release
description: "Use before merging or deploying frontend changes in agentic-commerce — checks affected zones and shared packages, builds, type checks, tests, Playwright through the shell, bundle/perf budgets, contract package versions, and per-zone Docker images. Trigger on \"ready to merge\", \"release the storefront\", \"deploy zone\", \"PR checklist\" in the frontend repo."
---

# Frontend release checklist

Zones deploy independently; shared packages fan out to every zone. Work out the blast radius first.

## 1. What changed?
```bash
git diff --stat origin/main...HEAD
pnpm exec turbo run build --dry=json --filter=...[origin/main] | node -e "const j=JSON.parse(require('fs').readFileSync(0));console.log(j.packages.join('\n'))"
```
| Changed | Extra checks |
|---|---|
| `packages/ui`, `agui-kit`, `agent-widget`, `bff` | build **all** zones; visual check shell + 1 zone |
| `apps/shell` or `zones.json` | every zone reachable through the shell; header links |
| agent UI (renderers, interrupt cards) | `frontend-reviewer` + backend `governance-reviewer` if behaviour changes |
| `@ac/contracts` / `@ac/money` version bump | matches a published version; changelog read; types compile |

## 2. Run
```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build lint test --filter=...[origin/main]
pnpm exec playwright test                       # through http://localhost:3300 with local stack running
docker build -f apps/<zone>/Dockerfile -t ac/zone-<zone>:rc .   # each affected zone (CI: linux/arm64 → ghcr.io/<owner>/ac/zone-<zone>)
```

## 3. Budgets
- First-load JS per route ≤ 200 kB gz (check `next build` output); LCP < 2.5 s on PDP/search.
- No new client component where a server component works; no `NEXT_PUBLIC_` secrets.

## 4. Deploy order
Backend contract changes must already be live (expand/contract). Deploy affected zones one by one; the
shell last if its rewrites/nav changed: `ac k8s deploy prod <zone> --tag <sha>` (platform repo, user approval),
rollback `ac k8s rollback prod <zone>` = previous tag of that zone only.

## Checklist
- [ ] Blast radius identified; all affected zones built and tested
- [ ] Playwright through the shell green
- [ ] Budgets respected; no secrets in client bundles
- [ ] Contract package versions published and compatible
- [ ] Docker images build for affected zones
- [ ] Platform docs (micro-frontends zone table, AG-UI table) updated if routes/agents changed
