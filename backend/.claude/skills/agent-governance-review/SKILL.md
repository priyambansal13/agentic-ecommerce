---
name: agent-governance-review
description: "Use to review a diff, branch or plan that touches services/agents, policies/, evals/, agent prompts, tool definitions or autonomy settings in agentic-commerce, checking it against the governance model in ../platform/docs/03-agentic-ai.md. Trigger on \"review agent change\", \"is this agent safe\", \"governance check\", or before merging any agent/tool/policy PR."
---

# Agent governance review

Scope: `git diff <base>...HEAD -- services/agents policies evals` (plus the agent UI diff in the frontend repo, if any) (or the files
the user names). Read `../platform/docs/03-agentic-ai.md` §3.1, §3.3, §3.8, §3.9 first. Report findings; do not fix
unless asked.

## Procedure
1. List changed graphs, nodes, prompts, tools, OPA rules, configs (autonomy, budgets, models).
2. For each changed tool, classify its tier yourself and compare with the declared tier.
3. Walk every path in changed graphs that can reach a WRITE_IRREVERSIBLE or MONEY tool and confirm a
   gate (OPA + state + autonomy, or `interrupt()`) on that path.
4. Run `node ../platform/scripts/ac.mjs policy test` and, if evals exist, `pnpm --filter @ac/agents run evals -- --agent <id>`.
5. Fill in the checklist; every ✗ becomes a finding.

## Checklist
**Authority & tools**
- [ ] No direct DB access, no raw `fetch` to services — only `invokeTool`
- [ ] Tier is correct (stricter if ambiguous); WRITE_IRREVERSIBLE not callable by agents
- [ ] MONEY tools: OPA envelope, case-state check, refundable amount, autonomy ≥ L3, killswitch, dual control above threshold
- [ ] Identity (buyer/seller ids) from token, never from model args
- [ ] Tool listed in `policies/agents/data.json` `agent_tools.<id>`; OPA `decision` returns reasons; deny tests for: not listed, wrong agent, over limit, wrong state, killswitch

**Model I/O**
- [ ] Every LLM output parsed with zod; failures escalate (not silently default to approve)
- [ ] Model output can only pick outcomes allowed by deterministic policy
- [ ] Untrusted text (buyer/seller/review/product) delimited via `untrusted()`; no instructions from it
- [ ] Prompts don't contain policy numbers that duplicate decision tables (drift risk)
- [ ] Model ids from tier config, not hard-coded

**HITL & autonomy**
- [ ] Escalation paths use `interrupt()` → AG-UI `RUN_FINISHED` interrupt outcome + approvals row + `agent.escalated.v1`
- [ ] Resume re-checks autonomy level and policy version
- [ ] Buyer is never told "approved/refunded" before the execute tool succeeded
- [ ] New agent/action starts at L1 (shadow) or L2

**Data & audit**
- [ ] Tool calls audited with redacted args; rationale stored for MONEY decisions
- [ ] Minimal fields to the model (no full address, no card data, no secrets)
- [ ] AG-UI events to buyers don't leak risk scores / rule internals

**Cost & resilience**
- [ ] recursionLimit / maxSteps, token and wall-clock budgets set
- [ ] OpenAI timeout + fallback UX; idempotent replays on resume (`runId:toolCallId`)

**Evals**
- [ ] Dataset updated for new behaviour; red-team cases for new tools
- [ ] Gate thresholds met (outcome accuracy not down > 2 pts, zero unauthorised MONEY calls)

## Output format
```
## Governance review — <scope>
Verdict: APPROVE | APPROVE WITH NITS | CHANGES REQUIRED
### Blocking
1. <file:line> — <issue> — <why it violates which rule> — <suggested fix>
### Non-blocking
...
### Verified
- policy tests: <result>  evals: <result or not run + why>
```
