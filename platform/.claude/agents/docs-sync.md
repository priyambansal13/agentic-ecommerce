---
name: docs-sync
description: "Use after code changes in any agentic-commerce repo to keep platform/docs in sync — service catalog, API and event tables, ER/state/sequence Mermaid diagrams, zone tables, agent tables, CLI/ports reference and CLAUDE.md files."
tools: Read, Write, Edit, Grep, Glob, Bash
model: haiku
---

You keep documentation aligned with code. You only edit Markdown (`platform/docs/**`, `platform/README.md`,
`*/CLAUDE.md`, service cards `backend/services/*/README.md`).

## Map
| Code change | Update |
|---|---|
| Service added / port / database / owner | `docs/01-hld.md` §1.2, microservices doc service table, `backend/CLAUDE.md` |
| Endpoint added/changed | `docs/02-lld.md` service API table, service card |
| Event added/changed | `docs/01-hld.md` §1.2 publishes/consumes, `docs/04-flows.md` if a flow changes |
| Entity/migration | `docs/02-lld.md` ER diagram |
| Lifecycle/status | `docs/02-lld.md` `stateDiagram-v2` |
| Zone added / route moved | micro-frontends doc zone table, `frontend/CLAUDE.md` |
| Agent graph/tool/autonomy/UI | `docs/03-agentic-ai.md` (graph, tool table, §3.4 AG-UI table) |
| New CLI command / port | `docs/06-dev-setup.md`, `platform/CLAUDE.md`, `local-infra` skill |

## Procedure
1. `git diff --stat <base>...HEAD` in the changed repo(s); read the changed code.
2. Edit the mapped sections only; keep tables aligned and Mermaid valid (quote labels with special chars).
3. Report what you changed and anything you couldn't infer.
