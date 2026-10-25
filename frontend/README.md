# agentic-commerce / frontend

**Micro-frontends** with Next.js 16 **Multi-Zones**: every zone is an independently built and deployed
Next.js app; the `shell` owns `/` and rewrites each zone's path to it, so users see one site.
Architecture: [`../platform/docs/08-microfrontends.md`](../platform/docs/08-microfrontends.md).

| Zone | Port | Path | Owner | Agents hosted |
|---|---|---|---|---|
| shell | 3300 | `/` | team-web-platform | — |
| storefront | 3301 | `/shop` | team-commerce | assistant, order-support |
| account | 3302 | `/account` | team-commerce | refund, order-support |
| seller | 3303 | `/seller` | team-seller | listing-copilot, seller-insights |
| admin | 3304 | `/admin` | team-trust | fraud-investigator, dispute (+ approvals) |

Source of truth: `zones.json`. Each `apps/<zone>/README.md` is its zone card (`pnpm gen sync`).

## Shared packages

| Package | Purpose |
|---|---|
| `@ac/ui` | design tokens (`@ac/ui/tokens.css`), `SiteHeader`, `ZoneLink` (hard navigation across zones), `Page` |
| `@ac/agui-kit` | AG-UI 1.0 reducer, `runAgentStream`, `useAgent(agentId, { basePath })` |
| `@ac/agent-widget` | `<AgentChat agentId basePath title toolRenderers interruptCards />` |
| `@ac/bff` | server-only `kongFetch()` and `agentRoute({ allow })` for each zone's BFF |
| `@ac/contracts`, `@ac/money` | **versioned packages from the backend repo** via the registry in `.npmrc` |

## Commands

```bash
pnpm install && pnpm build && pnpm test       # needs the registry: node ../platform/scripts/ac.mjs infra up
pnpm dev                                      # all zones → http://localhost:3300
pnpm dev --filter @ac/zone-shell... --filter @ac/zone-storefront...
pnpm gen zone <name> --base /<path> [--port N]
pnpm gen sync
pnpm update @ac/contracts @ac/money           # after the backend publishes new versions
docker build -f apps/<zone>/Dockerfile -t ac/zone-<zone> .   # or: ac docker build <zone>
```

## Deployment

Production runs on **k3s on an Oracle Cloud Always Free VM** (platform repo, `deploy/`). Each zone is its own
Deployment + Service `zone-<zone>` (Secret `zone-<zone>`); the Traefik ingress sends `/` to `zone-shell`, which
rewrites to the other zones (`http://zone-<name>:<port>`, baked in at shell build time). NetworkPolicies let
only the shell call zones, and zones call only Kong. CI builds affected zones as **linux/arm64** images to
`ghcr.io/<owner>/ac/zone-<zone>`; deploy/rollback with `ac k8s deploy prod <zone> --tag <sha>` /
`ac k8s rollback prod <zone>`.

Claude Code: `CLAUDE.md`, `.claude/skills`, `.claude/agents`.
