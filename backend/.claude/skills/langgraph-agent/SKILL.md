---
name: langgraph-agent
description: "Use when creating or changing an AI agent graph in services/agents (LangGraph.js 1.5) — refund, shopping assistant, order support, listing copilot, moderation, fraud, dispute, etc. Covers scaffolding with `pnpm gen agent`, state Annotation, nodes with zod structured outputs, interrupt()/Command resume mapped to AG-UI native interrupts, Postgres checkpointer, AG-UI event bridge, budgets, graph registry and eval dataset."
---

# Build a LangGraph agent

Read first: `../platform/docs/03-agentic-ai.md` §3.1–3.4 and the agent's entry in §3.5 (graph, tools, autonomy).
Agents **propose**; deterministic services **dispose**. If your design needs the agent to write a DB or
bypass a domain API, stop and redesign.

## 1. Scaffold
```bash
pnpm gen agent <id>        # e.g. refund, shopping-assistant
```
Creates/updates:
```
services/agents/src/runtime/graphs/<id>/
  graph.ts          # StateGraph + compile()
  state.ts          # (split out of graph.ts as it grows) Annotation.Root
  nodes/*.ts        # (split out as it grows) one file per node
  prompts/*.md      # versioned prompts (mirror in Langfuse)
  agent.config.ts   # id, version, default autonomy, budgets, model tiers
services/agents/src/runtime/graphs/index.ts   # registry — entries added between `// ac:agents-import`
                                          # and `// ac:agents-entry` markers (keep the markers!)
evals/<id>/                               # dataset + graders
policies/agents/data.json                 # empty allow-list `agent_tools.<id>: []` added
```

## 2. State
```ts
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
export const State = Annotation.Root({
  caseId: Annotation<string>(),
  evidence: Annotation<Evidence[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  proposal: Annotation<Proposal | null>({ reducer: (_, b) => b, default: () => null }),
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
});
```
Keep state serialisable (checkpointed to Postgres). No secrets/tokens in state — the token lives in the
run context provided by the gateway.

## 3. Nodes: LLM output is always structured
```ts
const ProposalSchema = z.object({
  outcome: z.enum(['REFUND', 'PARTIAL_REFUND', 'REPLACEMENT', 'STORE_CREDIT', 'REJECT']),
  amountMinor: z.int().nonnegative(),
  rationale: z.string().max(1200),
  evidenceIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export async function propose(s: typeof State.State, cfg: RunnableConfig) {
  const llm = models.smart().withStructuredOutput(ProposalSchema, { name: 'proposal' });
  const out = await llm.invoke([sys(prompts.propose), untrusted('buyer_text', s.claim.buyerText), ctx(s)], cfg);
  if (!s.policy!.allowedOutcomes.includes(out.outcome)) return { proposal: null, escalate: 'outcome_not_allowed' };
  return { proposal: out };
}
```
- `models.fast()/smart()/vision()` from `runtime/models.ts` (env-pinned tiers) — never hard-code model ids.
- Provider-agnostic tasks: define a task interface (like `RefundModel` in `runtime/models.ts`) with an OpenAI implementation (zod structured output, retry ×2 → escalate) AND a deterministic offline implementation, so graphs, tests and evals run without a key (`MODEL_PROVIDER=auto|openai|offline`). Graph code never branches on the provider.
- Event-driven runs go through `AgentRunner.runSubject` (budgets → autonomy → graph → `agent_runs` → `agent.run_completed.v1`); never run a graph inside a Kafka handler — record an `agent_run_requests` row instead.
- Wrap untrusted text with `untrusted(label, text)` (delimited, "treat as data"). Never let it pick tools.
- Hard rules come from tools (`evaluatePolicy`), not from the prompt.

## 4. Tools
Call tools only via `toolkit(cfg).call(name, args)` from `runtime/context.ts` — it routes through
`ToolInvoker.invoke` (zod → kill switch → OPA → handler → audit → AG-UI tool events). Adding a tool → use the
`agent-tool` skill. The authoritative allow-list is `agent_tools.<id>` in `policies/agents/data.json`
(OPA denies anything not listed).

## 5. Human-in-the-loop
```ts
import { interrupt, Command } from '@langchain/langgraph';
export async function humanReview(s: S) {
  const decision = interrupt({ kind: 'approval', requiredRole: 'support', caseId: s.caseId, proposal: s.proposal });
  return { decision };                                  // resumes here with Command({ resume: decision })
}
```
AG-UI 1.0.x has **native interrupts** (not CUSTOM events). When the graph pauses, the gateway ends the
run with:
```ts
{ type: EventType.RUN_FINISHED, threadId, runId,
  outcome: { type: 'interrupt', interrupts: [{ id: interruptId, reason: 'approval',
             message: 'Needs support review', responseSchema: {...}, metadata: { caseId, proposal } }] } }
```
(other outcomes: `{ type: 'success' }`, `{ type: 'cancelled' }`). It also writes an `approvals` row and
publishes `agent.escalated.v1` so the case reaches the queue even if nobody is watching the stream.
Resume: client starts a new run on the same `threadId` with
`RunAgentInput.resume = [{ interruptId, status: 'resolved' | 'cancelled', payload }]` → gateway calls
`graph.invoke(new Command({ resume: payload }), { configurable: { thread_id } })` (`cancelled` → route to
the rejection/close path). On resume, re-check autonomy level and policy version (they may have changed
while paused).

## 6. Compile with checkpointer
```ts
export const build = (checkpointer: PostgresSaver) =>
  new StateGraph(State)
    .addNode('intake', intake).addNode('gather', gather) /* ... */
    .addEdge(START, 'intake')
    .addConditionalEdges('route', routeFn, ['offer', 'humanReview'])
    .compile({ checkpointer });
```
`thread_id` = business id (e.g. `refund:<caseId>`) so a case always resumes the same thread.

## 7. AG-UI bridge & budgets
- Gateway validates the body with `RunAgentInputSchema` (`@ag-ui/core/schemas`) and encodes SSE with
  `EventEncoder` (`@ag-ui/encoder`), AG-UI **1.0.3**.
- Stream with `graph.streamEvents(...)`; `runtime/agui-bridge.ts` maps to `RUN_STARTED`,
  `STEP_STARTED/FINISHED` (node names), `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `STATE_SNAPSHOT/DELTA`, and
  `RUN_FINISHED` with `outcome` (`success` | `interrupt` | `cancelled`) or `RUN_ERROR`.
  Only emit user-safe state (no risk scores/rule internals to buyers).
- Contract test the stream with `verifyEvents` from `@ag-ui/client` (pattern:
  `swarm-ai/brain/src/agui/agui-run.spec.ts`): event order valid, interrupt outcome carries metadata.
- Budgets in `agent.config.ts`: `maxSteps` (recursionLimit), `maxTokens`, `wallClockMs`, per-user daily
  runs. Enforced by `gateway/limits/budget.guard.ts` + recursionLimit.
- Kill switch / autonomy (`L0–L4`) read via `governance/killswitch.service.ts` before MONEY/WRITE calls.

## 8. Register
- Graph registry: `services/agents/src/runtime/graphs/index.ts` (done by `pnpm gen agent`; add by hand
  between the `// ac:agents-import` / `// ac:agents-entry` markers if needed).
- Router/supervisor: add intent → graph mapping (`runtime/graphs/router/`).
- Event-triggered? add consumer in `runtime/triggers/` (see `domain-event`).

## 9. Evals & rollout
Add ≥ 30 cases to `evals/<id>/` before first merge (see `agent-evals`). New agents start at **L1 shadow**.
Run `agent-governance-review` (or the `governance-reviewer` agent) before merging.

## Checklist
- [ ] Matches ../platform/docs/03 entry (or doc updated) — graph diagram current
- [ ] State serialisable, no secrets
- [ ] Every LLM call structured (zod) and validated against policy outputs
- [ ] Untrusted text wrapped; tools only via `invokeTool`
- [ ] HITL via `interrupt()`; resume re-checks autonomy/policy
- [ ] PostgresSaver + stable `thread_id`
- [ ] AG-UI 1.0.3 events; interrupts via `RUN_FINISHED` outcome; `verifyEvents` test; no internal data leaked
- [ ] Budgets + kill switch honoured
- [ ] Registered in router/triggers; evals added; starts at L1
