---
name: agent-tool
description: "Use when adding or changing a tool that an agent in services/agents can call — registry entry with zod schema, risk tier (READ / WRITE_REVERSIBLE / WRITE_IRREVERSIBLE / MONEY), scope, OPA rule plus _test.rego, idempotency key runId:toolCallId, audit and guardrails. Trigger on \"give the agent ability to…\", \"new tool\", \"let agent call X API\"."
---

# Add an agent tool

Tools are the **only** way agents affect the world. Every tool wraps an existing domain API — if the API
doesn't exist, build it first with the `api-endpoint` skill (with idempotency + ownership checks).

## 1. Pick the tier (../platform/docs/03-agentic-ai.md §3.3)
| Tier | Examples | Gate |
|---|---|---|
| READ | getOrder, getTracking, searchProducts | scope + service ownership check |
| WRITE_REVERSIBLE | addToCart, saveListingDraft, requestBuyerEvidence | user confirm (AG-UI frontend tool) or autonomy ≥ L3 |
| WRITE_IRREVERSIBLE | publishListing, cancelOrder, sanctionSeller | **human only** — agent may pre-fill, not call |
| MONEY | executeRefund, issueStoreCredit, createReplacementOrder | OPA envelope + case state + autonomy ≥ L3, else `interrupt()`; dual control above threshold |

When unsure, pick the stricter tier.

## 2. Registry entry
```ts
// services/agents/src/tools/definitions/execute-refund.ts
export const executeRefund = defineTool({
  name: 'executeRefund',
  description: 'Execute an already AUTO_APPROVED or human-APPROVED refund case.',  // model-facing: precise, no hype
  tier: 'MONEY',
  scope: 'refunds:execute:auto',
  agents: ['refund'],
  input: z.object({ caseId: z.uuid(), amountMinor: z.int().positive() }),
  output: z.object({ status: z.enum(['REFUND_PENDING', 'REJECTED']), refundId: z.uuid().optional() }),
  // typed HTTP clients live in services/agents/src/tools/clients/ (create one per domain service when first needed;
  // they call Kong with the exchanged agent token and send ctx.idempotencyKey on writes)
  opaContext: async (ctx, args) => ({ case: await returnsClient(ctx).getCase(args.caseId),
                                      order: await orderClient(ctx).getRefundable(args.caseId) }),
  handler: (ctx, args) => returnsClient(ctx).execute(args.caseId, args.amountMinor,
                                                      { idempotencyKey: `${ctx.runId}:${ctx.toolCallId}` }),
});
```
Register it in `services/agents/src/tools/registry.ts`. Args from the model are **never** trusted for
identity: buyerId/sellerId come from the token, not from args.

## 3. invokeTool pipeline (already implemented — don't bypass)
`zod.parse(args) → killswitch/autonomy → OPA authorize(agent, tool, tier, args, opaContext) →
guardrail pre-checks → HTTP call with agent token (act=agent:<id>) + Idempotency-Key →
output.parse → audit (hash-chained tool_calls row, args redacted)`.

## 4. OPA policy + tests
Policy: `policies/agents/tools.rego`, package `agents.tools`. The gateway queries
`POST /v1/data/agents/tools/decision` and gets `{ allow, reasons }` — denials must add a reason.
Static data (allow-lists, limits, kill switch) lives in `policies/agents/data.json`:
```json
{ "agent_tools": { "refund": ["getOrder", "evaluatePolicy", "executeRefund"] },
  "limits": { "refund": { "auto_max_minor": { "INR": 200000 }, "max_risk": 0.3 } },
  "killswitch": { "refund": false } }
```
1. Add the tool name to `agent_tools.<agentId>` (nothing is callable unless listed).
2. Add tier-specific rules, e.g. for MONEY:
```rego
package agents.tools

money_ok if {
  input.tool == "executeRefund"
  input.agent.autonomy_level >= 3
  input.case.status in {"AUTO_APPROVED", "APPROVED"}
  input.args.amount_minor <= input.order.refundable_minor
  input.args.amount_minor <= data.limits.refund.auto_max_minor[input.order.currency]
  not data.killswitch[input.agent.id]
}
```
Hook it into the existing `decision` / `reasons` rules (follow the pattern already in the file;
each failing condition should contribute a human-readable reason).
3. Tests in `policies/agents/tools_test.rego`:
```rego
test_refund_over_envelope_denied if {
  d := decision with input as {"tool": "executeRefund", "tier": "MONEY",
      "agent": {"id": "refund", "autonomy_level": 3}, "case": {"status": "AUTO_APPROVED"},
      "order": {"currency": "INR", "refundable_minor": 9999999}, "args": {"amount_minor": 500000}}
  not d.allow
  count(d.reasons) > 0
}
```
Write at least: allowed happy path, tool not in allow-list, wrong agent, over-limit, wrong case state,
killswitch on. Run `node ../platform/scripts/ac.mjs policy test`.

## 5. Guardrails
- READ tools: return minimum fields (data minimisation; e.g. city/pincode, not full address).
- Tool results containing user text (reviews, chats) are marked untrusted before re-entering prompts.
- MONEY: amount ≤ refundable, currency matches order, no execution before human approval exists.

## 6. Tests
- Unit: schema rejects bad args; handler uses token identity; idempotency key format.
- Integration: OPA deny → no HTTP call; replay with same toolCallId → one effect.
- Eval: add red-team case where buyer text tries to trigger this tool (must not call it).

## Checklist
- [ ] Wraps an existing idempotent, ownership-checked domain API
- [ ] Correct tier (stricter if unsure); scope added to Keycloak agent client
- [ ] zod input/output; identity from token, not args
- [ ] Listed in `data.json` `agent_tools.<id>`; OPA rule with reasons + ≥ 5 cases in `tools_test.rego`; `node ../platform/scripts/ac.mjs policy test` green
- [ ] Idempotency `runId:toolCallId`; audit row redacts PII
- [ ] Red-team eval case added
- [ ] ../platform/docs/03 tool table updated
