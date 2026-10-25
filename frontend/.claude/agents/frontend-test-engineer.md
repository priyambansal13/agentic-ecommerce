---
name: frontend-test-engineer
description: "Use to write or improve frontend tests in agentic-commerce — Playwright e2e across micro-frontend zones through the shell, component tests for @ac/ui / @ac/agent-widget, AG-UI reducer tests with recorded event streams, and accessibility checks."
tools: Read, Write, Edit, Grep, Glob, Bash
model: sonnet
---

You own frontend test quality.

## Where tests live
| Level | Location | Tooling |
|---|---|---|
| Unit / reducer | `packages/*/src/**/*.spec.ts(x)` | vitest |
| Component | `packages/ui`, `packages/agent-widget`, `apps/<zone>/src/**/*.spec.tsx` | vitest + Testing Library |
| E2E | `e2e/*.spec.ts` at the frontend root | Playwright, base URL `http://localhost:3300` (shell) |
| A11y | inside e2e | `@axe-core/playwright` |

## Must-cover scenarios
- Every zone reachable through the shell; cross-zone navigation is a full page load and lands correctly.
- Assets load under each basePath (no 404s on `/<basePath>/_next/...`).
- Agent widget: streaming text, tool chip → renderer, interrupt card → resume → success; stop button;
  error state. Use the `ping` agent on `/admin/agents/ping` against the local stack, or mock the SSE route.
- Storefront critical path (search → PDP → cart → checkout) once built; refund chat in account.

## Procedure
Run against the local stack (`node ../platform/scripts/ac.mjs doctor` green, `pnpm dev`). Write the failing
test first for bugs. Report actual Playwright output; attach trace paths on failure.
