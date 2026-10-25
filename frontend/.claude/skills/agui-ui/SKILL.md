---
name: agui-ui
description: "Use when building agent-facing UI in any micro-frontend zone (storefront, account, seller, admin) of the agentic-commerce frontend — AG-UI client wiring, generative UI (tool name → React component), interrupt cards (approve/reject/upload/offer), frontend tools that need user confirmation, shared state via STATE_SNAPSHOT/STATE_DELTA, and the /api/agents/[agentId]/run proxy. Trigger on \"chat widget\", \"assistant drawer\", \"approval card\", \"render tool result\", \"copilot UI\"."
---

# AG-UI frontend

Where AG-UI is used is fixed in `../platform/docs/03-agentic-ai.md` §3.4 (assistant, refund/support chat, listing
copilot, seller insights, admin approval/dispute/fraud consoles). Don't add agent UI to checkout/payment.

## 0. Zone mapping
| Agent | Zone (basePath) |
|---|---|
| shopping assistant | storefront `/shop` |
| order support, refund/returns chat | account `/account` |
| listing copilot, seller insights | seller `/seller` |
| approvals queue, dispute desk, fraud console, `ping` check | admin `/admin` |
The widget and hook live in shared packages (`@ac/agent-widget`, `@ac/agui-kit`); zone-specific
renderers and interrupt cards live **in the zone** (`apps/<zone>/src/agents/`).

## 1. Proxy route per zone (tokens stay server-side)
Each zone exposes its own BFF route under its basePath — one line, from `@ac/bff`:
```ts
// apps/<zone>/src/app/api/agents/[agentId]/run/route.ts   → served at /<basePath>/api/agents/<id>/run
import { agentRoute } from '@ac/bff';
export const POST = agentRoute();          // proxies to Kong /api/agents/v1/agents/:id/run (SSE passthrough)
export const dynamic = 'force-dynamic';
```
`agentRoute()` validates the agent id, streams the body through, and (TODO P1) attaches the user's access
token from the Auth.js session. Never expose the token or the agents/Kong URL to the browser.

## 2. Widget + hook
```tsx
// apps/storefront/src/app/assistant.tsx
'use client';
import { AgentChat } from '@ac/agent-widget';
import { toolRenderers, interruptCards } from '../agents/renderers';

export function Assistant() {
  return <AgentChat agentId="assistant" basePath="/shop" title="Shopping assistant"
                    toolRenderers={toolRenderers} interruptCards={interruptCards} />;
}
```
Custom layouts use the hook directly: `useAgent(agentId, { basePath, threadId, tools, initialState })` → `{ ui, send, resume, cancel }` wraps the minimal SSE client `runAgentStream` (AG-UI 1.0.3 events)
(url `<basePath>/api/agents/<id>/run`) and the reducer in `@ac/agui-kit`:
| AG-UI event | UI state |
|---|---|
| `RUN_STARTED/FINISHED/ERROR` | `status`, error toast, retry |
| `STEP_STARTED/FINISHED` | progress line ("Checking tracking…") |
| `TEXT_MESSAGE_START/CONTENT/END` | streaming assistant bubble |
| `TOOL_CALL_START/ARGS/END/RESULT` | tool chip → generative component when result arrives |
| `STATE_SNAPSHOT` / `STATE_DELTA` (JSON Patch) | `agentState` (apply with `fast-json-patch`) |
| `RUN_FINISHED` with `outcome.type = 'interrupt'` | pending interrupt card(s) from `outcome.interrupts[]` (`id, reason, message, responseSchema, metadata`) |
| `RUN_FINISHED` `success` / `cancelled` | idle / cancelled notice |

## 3. Generative UI registry
```tsx
// apps/<zone>/src/agents/renderers.tsx
export const toolRenderers: Record<string, (r: ToolResult) => ReactNode> = {
  searchProducts: (r) => <ProductCarousel items={r.result.hits} />,
  getOrder: (r) => <OrderTimeline order={r.result} />,
  getSales: (r) => <SalesChart series={r.result.series} />,
};
```
Render prices, stock, amounts **from tool result data**, never from assistant text. Unknown tool → small
neutral chip, not raw JSON.

## 4. Interrupt cards (native AG-UI interrupts)
Cards are chosen by `interrupt.reason`; data comes from `interrupt.metadata`:
```tsx
const interruptCards: Record<string, (i: Interrupt, resolve: (payload: unknown) => void) => ReactNode> = {
  upload_photo: (i, resolve) => <EvidenceUpload caseId={i.metadata.caseId} onDone={(id) => resolve({ evidenceId: id })} />,
  offer:        (i, resolve) => <RefundOfferCard options={i.metadata.options} onChoose={(c) => resolve({ choice: c })} />,
  approval:     (i, resolve) => <ApprovalCard proposal={i.metadata.proposal} onDecide={(d) => resolve(d)} />, // staff only
};
```
Resume = new run on the **same `threadId`** whose `RunAgentInput` carries
`resume: [{ interruptId: i.id, status: 'resolved', payload }]`; a dismiss/cancel sends
`status: 'cancelled'`. Validate the payload against `i.responseSchema` before sending. Approval cards show
evidence, rule hits, agent rationale, allow editing the amount, and disable double-submit.

## 5. Frontend tools (user confirmation)
WRITE_REVERSIBLE actions on the buyer's behalf go through a frontend tool:
```ts
const confirmAddToCart: FrontendTool = {
  name: 'confirmAddToCart',
  description: 'Ask the user to confirm adding a SKU to the cart',
  parameters: { type: 'object', properties: { skuId: { type: 'string' }, qty: { type: 'integer' } }, required: ['skuId', 'qty'] },
  handler: async ({ skuId, qty }) => ({ confirmed: await openConfirmDialog({ skuId, qty }) }), // price fetched from catalog in the dialog
};
```

## 6. Shared state (listing copilot)
Form ↔ agent co-edit `agentState.draft`. On user edit, send current state with the next run; apply agent
`STATE_DELTA` patches but never overwrite a field the user is focused on (show "Agent suggests…" instead).

## 7. UX & a11y
Streaming text in an `aria-live="polite"` region; stop button aborts the run; clear "AI-generated" label;
fallback link to the classic form (agents are optional on every path); errors never show stack traces.

## 8. Tests
Reducer unit tests with recorded event streams (`packages/agui-kit/src/*.spec.ts`, fixtures in
`packages/agui-kit/test/fixtures/*.jsonl`); widget component tests; Playwright e2e through the shell
(`http://localhost:3300/<basePath>/…`) with a mocked or `ping` agent for refund chat and approval card.
Changing `@ac/agui-kit` or `@ac/agent-widget` affects every zone → run all zone builds (`pnpm build`).

## Checklist
- [ ] Zone-local BFF route via `agentRoute()`, token server-side
- [ ] Widget/hook from shared packages; renderers + cards owned by the zone
- [ ] Event → state mapping via `@ac/agui-kit`
- [ ] Facts rendered from tool data
- [ ] Interrupts read from `RUN_FINISHED.outcome`; resume via `RunAgentInput.resume` on same thread; no double submit
- [ ] Writes on user's behalf via frontend-tool confirmation
- [ ] AI label, stop button, fallback to classic flow
- [ ] Reducer tests + e2e
