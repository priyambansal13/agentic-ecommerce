'use client';
import { type UiInterrupt, type UiToolCall, useAgent } from '@ac/agui-kit';
import { type ReactNode, useState } from 'react';

export type ToolRenderer = (call: UiToolCall) => ReactNode;
export type InterruptCard = (interrupt: UiInterrupt, resolve: (payload: unknown) => void, cancel: () => void) => ReactNode;

export interface AgentChatProps {
  agentId: string;
  /** hosting zone's basePath ('/shop', '/account', …) — the run goes through that zone's BFF */
  basePath: string;
  title?: string;
  placeholder?: string;
  initialMessage?: string;
  /** generative UI: render a tool result by tool name (prices etc. come from tool data, never model text) */
  toolRenderers?: Record<string, ToolRenderer>;
  /** native AG-UI interrupt cards by interrupt.reason (approval, offer, upload_photo …) */
  interruptCards?: Record<string, InterruptCard>;
}

const DefaultInterrupt: InterruptCard = (i, resolve, cancel) => (
  <div className="rounded-[var(--radius)] border border-[var(--accent)] p-3">
    <p className="mb-2">{i.message ?? i.reason}</p>
    <div className="flex gap-2">
      <button type="button" className="rounded bg-[var(--accent)] px-3 py-1 text-[var(--accent-fg)]" onClick={() => resolve({ approved: true })}>
        Approve
      </button>
      <button type="button" className="rounded border border-[var(--line)] px-3 py-1" onClick={() => resolve({ approved: false })}>
        Reject
      </button>
      <button type="button" className="px-3 py-1 text-[var(--muted)]" onClick={cancel}>
        Cancel
      </button>
    </div>
  </div>
);

/** Drop-in agent conversation for any zone. One component, many agents — behaviour comes from the agent. */
export function AgentChat({ agentId, basePath, title, placeholder, initialMessage = '', toolRenderers = {}, interruptCards = {} }: AgentChatProps) {
  const { ui, send, resume } = useAgent(agentId, { basePath });
  const [text, setText] = useState(initialMessage);
  const busy = ui.status === 'running';

  return (
    <section aria-label={title ?? `${agentId} agent`} className="space-y-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--card)] p-4">
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
      <div className="space-y-2 text-sm" aria-live="polite">
        {ui.messages.map((m) => (
          <p key={m.id} className={m.role === 'user' ? 'text-right' : ''}>
            <span className={`inline-block rounded-md px-3 py-1.5 ${m.role === 'user' ? 'bg-[var(--line)]' : 'border border-[var(--line)]'}`}>{m.content}</span>
          </p>
        ))}
        {ui.toolOrder.map((id) => {
          const call = ui.toolCalls[id];
          const render = toolRenderers[call.name];
          if (render && call.done) return <div key={id}>{render(call)}</div>;
          return (
            <p key={id} className="text-xs text-[var(--muted)]">
              tool <code>{call.name}</code> {call.done ? '✓' : '…'}
            </p>
          );
        })}
        {ui.activeSteps.length > 0 && <p className="text-xs text-[var(--muted)]">working: {ui.activeSteps.join(', ')}</p>}
        {ui.interrupts.map((i) => (
          <div key={i.id}>{(interruptCards[i.reason] ?? DefaultInterrupt)(i, (payload) => resume(i.id, payload), () => resume(i.id, undefined, 'cancelled'))}</div>
        ))}
        {ui.error && <p className="text-[var(--danger)]">{ui.error}</p>}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void send(text.trim());
          setText('');
        }}
      >
        <input
          aria-label="Message"
          className="flex-1 rounded border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm"
          placeholder={placeholder ?? 'Type a message'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button disabled={busy} className="rounded bg-[var(--fg)] px-4 py-1.5 text-sm text-[var(--bg)] disabled:opacity-50">
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
