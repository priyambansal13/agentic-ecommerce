---
name: architecture-decision
description: "Use when making or changing an architectural choice in agentic-commerce — new service or zone, data ownership, sync vs async integration, new technology, agent autonomy changes, security model changes — and recording it as an ADR in platform/docs/adr with the affected design docs updated. Trigger on \"should we\", \"which approach\", \"ADR\", \"design decision\", \"split/merge services\"."
---

# Architecture decision record

Docs are the source of truth (`platform/docs/00–06` plus the microservices and micro-frontends docs).
ADRs live in `platform/docs/adr/NNNN-<slug>.md`; never contradict an accepted ADR silently — supersede it.

## 1. Frame
- Requirement/NFR it serves (`docs/00-pdf-analysis.md`, `01-hld.md` §1.9).
- Options (2–3 realistic), each with cost, ops burden, consistency, latency, team ownership, agent impact.
- Microservice test: does it give clear data ownership and independent deployability? If a "service"
  needs another's database or lock-step deploys, it isn't one.
- Micro-frontend test: does the zone map to a domain/team with its own routes? Otherwise keep it a page.

## 2. Write the ADR
```markdown
# NNNN. <Decision title>
- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD
## Context
## Options considered
## Decision
## Consequences (positive, negative, follow-ups)
## Affected: services / zones / docs sections / repos
```
Number = next free in `docs/adr/`. Keep it to one page.

## 3. Update the design
Edit the affected tables and Mermaid diagrams in `docs/01–04` and the microservices/micro-frontends docs
(Mermaid must stay valid). If code must change, hand off via `cross-repo-change`.

## Checklist
- [ ] Options compared on the same criteria; recommendation explicit
- [ ] ADR written with status and consequences
- [ ] Design docs/diagrams updated; superseded ADRs marked
- [ ] Follow-up work listed per repo
